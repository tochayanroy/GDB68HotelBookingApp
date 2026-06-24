const express = require('express');
const router = express.Router();
const passport = require('passport');
const mongoose = require('mongoose');
const moment = require('moment');

const Booking = require('../models/BookingSchema.js');
const Hotel = require('../models/HotelSchema.js');
const Room = require('../models/RoomSchema.js');
const User = require('../models/UserSchema.js');
const Payment = require('../models/PaymentSchema.js');

// ==================== HELPER FUNCTIONS ====================

// Generate unique booking number
function generateBookingNumber() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `BKG-${timestamp}-${random}`;
}

// Calculate total nights between dates
function calculateNights(checkIn, checkOut) {
    const diff = new Date(checkOut) - new Date(checkIn);
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// Check room availability for dates
async function checkRoomAvailability(roomId, checkIn, checkOut, requestedQuantity) {
    const bookings = await Booking.find({
        'rooms.room': roomId,
        bookingStatus: { $in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] },
        $or: [
            { checkInDate: { $lt: checkOut, $gte: checkIn } },
            { checkOutDate: { $gt: checkIn, $lte: checkOut } }
        ]
    });

    let bookedCount = 0;
    bookings.forEach(booking => {
        booking.rooms.forEach(room => {
            if (room.room.toString() === roomId.toString()) {
                bookedCount += room.quantity;
            }
        });
    });

    return requestedQuantity <= (room.totalRooms - bookedCount);
}

// ==================== CREATE BOOKING ====================
router.post('/bookings', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const {
            hotelId,
            rooms,
            checkInDate,
            checkOutDate,
            guestDetails,
            specialRequest,
            bookingSource = 'WEB'
        } = req.body;

        // Validate hotel
        const hotel = await Hotel.findOne({
            _id: hotelId,
            isActive: true,
            status: 'APPROVED'
        });

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found or not available' });
        }

        // Validate check-in/check-out dates
        const checkIn = new Date(checkInDate);
        const checkOut = new Date(checkOutDate);

        if (checkIn >= checkOut) {
            return res.status(400).json({ error: 'Check-out date must be after check-in date' });
        }

        if (checkIn < new Date()) {
            return res.status(400).json({ error: 'Check-in date cannot be in the past' });
        }

        const totalNights = calculateNights(checkIn, checkOut);

        // Validate rooms and calculate pricing
        let roomAmount = 0;
        let totalRoomsCount = 0;
        const validatedRooms = [];

        for (const roomData of rooms) {
            const room = await Room.findOne({
                _id: roomData.roomId,
                hotel: hotelId,
                isActive: true,
                status: 'AVAILABLE'
            });

            if (!room) {
                return res.status(404).json({ error: `Room ${roomData.roomId} not found or not available` });
            }

            // Check availability
            const isAvailable = await checkRoomAvailability(
                room._id,
                checkIn,
                checkOut,
                roomData.quantity || 1
            );

            if (!isAvailable) {
                return res.status(400).json({ error: `Room ${room.roomName} is not available for selected dates` });
            }

            // Calculate room price
            const pricePerNight = room.discountPrice || room.pricePerNight;
            const roomTotal = pricePerNight * totalNights * (roomData.quantity || 1);

            validatedRooms.push({
                room: room._id,
                quantity: roomData.quantity || 1,
                adults: roomData.adults || 1,
                children: roomData.children || 0,
                pricePerNight: pricePerNight,
                totalPrice: roomTotal
            });

            roomAmount += roomTotal;
            totalRoomsCount += roomData.quantity || 1;
        }

        // Calculate taxes and charges (example: 18% tax, 2% service charge)
        const taxAmount = roomAmount * 0.18;
        const serviceCharge = roomAmount * 0.02;
        const finalAmount = roomAmount + taxAmount + serviceCharge;

        // Validate guest details
        if (!guestDetails || guestDetails.length === 0) {
            return res.status(400).json({ error: 'Guest details are required' });
        }

        // Create booking
        const booking = new Booking({
            bookingNumber: generateBookingNumber(),
            user: req.user._id,
            hotel: hotelId,
            rooms: validatedRooms,
            checkInDate: checkIn,
            checkOutDate: checkOut,
            totalNights,
            guestDetails,
            pricing: {
                roomAmount,
                taxAmount,
                serviceCharge,
                finalAmount
            },
            specialRequest,
            bookingSource,
            bookingStatus: 'PENDING'
        });

        await booking.save();

        // Populate booking details
        const populatedBooking = await Booking.findById(booking._id)
            .populate('user', 'Name email phone')
            .populate('hotel', 'name slug address')
            .populate('rooms.room', 'roomName roomNumber roomType');

        res.status(201).json({
            message: 'Booking created successfully',
            booking: populatedBooking
        });

    } catch (error) {
        console.error('Create booking error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== CONFIRM BOOKING (Payment) ====================
router.put('/bookings/:bookingId/confirm', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { paymentId } = req.body;

        if (!mongoose.Types.ObjectId.isValid(bookingId)) {
            return res.status(400).json({ error: 'Invalid booking ID' });
        }

        const booking = await Booking.findOne({
            _id: bookingId,
            user: req.user._id,
            bookingStatus: 'PENDING'
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found or already confirmed' });
        }

        // Verify payment
        const payment = await Payment.findOne({
            _id: paymentId,
            booking: bookingId,
            status: 'COMPLETED'
        });

        if (!payment) {
            return res.status(400).json({ error: 'Payment not completed or not found' });
        }

        // Update booking status
        booking.bookingStatus = 'CONFIRMED';
        booking.payment = paymentId;
        await booking.save();

        // Update room availability
        for (const roomData of booking.rooms) {
            await Room.findByIdAndUpdate(roomData.room, {
                $inc: { availableRooms: -roomData.quantity }
            });
        }

        // Populate booking
        const updatedBooking = await Booking.findById(bookingId)
            .populate('user', 'Name email phone')
            .populate('hotel', 'name slug address')
            .populate('rooms.room', 'roomName roomNumber roomType');

        res.json({
            message: 'Booking confirmed successfully',
            booking: updatedBooking
        });

    } catch (error) {
        console.error('Confirm booking error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET MY BOOKINGS ====================
router.get('/my-bookings', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            status,
            startDate,
            endDate,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const query = { user: req.user._id };

        if (status && status !== 'all') {
            query.bookingStatus = status;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [bookings, totalCount] = await Promise.all([
            Booking.find(query)
                .populate('hotel', 'name slug thumbnail address starRating')
                .populate('rooms.room', 'roomName roomNumber roomType')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Booking.countDocuments(query)
        ]);

        res.json({
            bookings,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalBookings: totalCount,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get my bookings error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET SINGLE BOOKING ====================
router.get('/bookings/:bookingId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { bookingId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(bookingId)) {
            return res.status(400).json({ error: 'Invalid booking ID' });
        }

        const booking = await Booking.findOne({
            _id: bookingId,
            user: req.user._id
        })
            .populate('user', 'Name email phone profileImage')
            .populate('hotel', 'name slug address contact policies starRating thumbnail')
            .populate('rooms.room', 'roomName roomNumber roomType amenities images')
            .populate('payment', 'paymentMethod amount status');

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        res.json(booking);

    } catch (error) {
        console.error('Get single booking error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== CANCEL BOOKING ====================
router.put('/bookings/:bookingId/cancel', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { cancellationReason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(bookingId)) {
            return res.status(400).json({ error: 'Invalid booking ID' });
        }

        const booking = await Booking.findOne({
            _id: bookingId,
            user: req.user._id,
            bookingStatus: { $in: ['PENDING', 'CONFIRMED'] }
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found or cannot be cancelled' });
        }

        // Check if cancellation is allowed
        const checkIn = new Date(booking.checkInDate);
        const now = new Date();
        const hoursUntilCheckIn = (checkIn - now) / (1000 * 60 * 60);

        if (hoursUntilCheckIn < 24) {
            return res.status(400).json({ error: 'Cancellation is not allowed within 24 hours of check-in' });
        }

        // Update booking status
        booking.bookingStatus = 'CANCELLED';
        booking.cancellation = {
            isCancelled: true,
            cancelledAt: new Date(),
            cancelledBy: req.user._id,
            cancellationReason: cancellationReason || 'Cancelled by user'
        };

        await booking.save();

        // Restore room availability
        for (const roomData of booking.rooms) {
            await Room.findByIdAndUpdate(roomData.room, {
                $inc: { availableRooms: roomData.quantity }
            });
        }

        res.json({
            message: 'Booking cancelled successfully',
            booking: {
                _id: booking._id,
                bookingNumber: booking.bookingNumber,
                bookingStatus: booking.bookingStatus,
                cancellation: booking.cancellation
            }
        });

    } catch (error) {
        console.error('Cancel booking error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== CHECK-IN ====================
router.patch('/bookings/:bookingId/check-in', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { bookingId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(bookingId)) {
            return res.status(400).json({ error: 'Invalid booking ID' });
        }

        const booking = await Booking.findOne({
            _id: bookingId,
            bookingStatus: 'CONFIRMED'
        }).populate('hotel', 'owner');

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found or not confirmed' });
        }

        // Check if user is hotel owner or admin
        if (booking.hotel.owner.toString() !== req.user._id.toString() &&
            req.user.role !== 'SUPER_ADMIN' &&
            req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'You are not authorized to check-in this booking' });
        }

        // Check if check-in is possible
        const checkIn = new Date(booking.checkInDate);
        const now = new Date();
        const hoursDiff = (checkIn - now) / (1000 * 60 * 60);

        if (hoursDiff > 6) {
            return res.status(400).json({ error: 'Check-in is only allowed within 6 hours of the scheduled time' });
        }

        booking.bookingStatus = 'CHECKED_IN';
        booking.checkedInAt = new Date();
        await booking.save();

        const updatedBooking = await Booking.findById(bookingId)
            .populate('user', 'Name email phone')
            .populate('hotel', 'name');

        res.json({
            message: 'Check-in successful',
            booking: updatedBooking
        });

    } catch (error) {
        console.error('Check-in error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== CHECK-OUT ====================
router.patch('/bookings/:bookingId/check-out', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { bookingId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(bookingId)) {
            return res.status(400).json({ error: 'Invalid booking ID' });
        }

        const booking = await Booking.findOne({
            _id: bookingId,
            bookingStatus: 'CHECKED_IN'
        }).populate('hotel', 'owner');

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found or not checked in' });
        }

        // Check if user is hotel owner or admin
        if (booking.hotel.owner.toString() !== req.user._id.toString() &&
            req.user.role !== 'SUPER_ADMIN' &&
            req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'You are not authorized to check-out this booking' });
        }

        booking.bookingStatus = 'CHECKED_OUT';
        booking.checkedOutAt = new Date();
        await booking.save();

        res.json({
            message: 'Check-out successful',
            booking: {
                _id: booking._id,
                bookingNumber: booking.bookingNumber,
                bookingStatus: booking.bookingStatus,
                checkedOutAt: booking.checkedOutAt
            }
        });

    } catch (error) {
        console.error('Check-out error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== COMPLETE BOOKING ====================
router.patch('/bookings/:bookingId/complete', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { bookingId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(bookingId)) {
            return res.status(400).json({ error: 'Invalid booking ID' });
        }

        const booking = await Booking.findOne({
            _id: bookingId,
            bookingStatus: 'CHECKED_OUT'
        }).populate('hotel', 'owner');

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found or not checked out' });
        }

        // Only hotel owner or admin can complete booking
        if (booking.hotel.owner.toString() !== req.user._id.toString() &&
            req.user.role !== 'SUPER_ADMIN' &&
            req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'You are not authorized to complete this booking' });
        }

        booking.bookingStatus = 'COMPLETED';
        await booking.save();

        // Update hotel statistics
        await Hotel.findByIdAndUpdate(booking.hotel, {
            $inc: { totalBookings: 1, totalRevenue: booking.pricing.finalAmount }
        });

        res.json({
            message: 'Booking completed successfully',
            booking: {
                _id: booking._id,
                bookingNumber: booking.bookingNumber,
                bookingStatus: booking.bookingStatus
            }
        });

    } catch (error) {
        console.error('Complete booking error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET HOTEL BOOKINGS (Owner) ====================
router.get('/hotel/:hotelId/bookings', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { hotelId } = req.params;
        const {
            page = 1,
            limit = 10,
            status,
            startDate,
            endDate,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findOne({ _id: hotelId, owner: req.user._id });

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found or you are not the owner' });
        }

        const query = { hotel: hotelId };

        if (status && status !== 'all') {
            query.bookingStatus = status;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [bookings, totalCount] = await Promise.all([
            Booking.find(query)
                .populate('user', 'Name email phone')
                .populate('rooms.room', 'roomName roomNumber roomType')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Booking.countDocuments(query)
        ]);

        // Calculate summary
        const summary = await Booking.aggregate([
            { $match: { hotel: new mongoose.Types.ObjectId(hotelId) } },
            {
                $group: {
                    _id: '$bookingStatus',
                    count: { $sum: 1 },
                    revenue: { $sum: '$pricing.finalAmount' }
                }
            }
        ]);

        res.json({
            hotel: {
                id: hotel._id,
                name: hotel.name
            },
            summary,
            bookings,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalBookings: totalCount,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get hotel bookings error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== MARK AS NO-SHOW ====================
router.patch('/bookings/:bookingId/no-show', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { bookingId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(bookingId)) {
            return res.status(400).json({ error: 'Invalid booking ID' });
        }

        const booking = await Booking.findOne({
            _id: bookingId,
            bookingStatus: 'CONFIRMED'
        }).populate('hotel', 'owner');

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found or not confirmed' });
        }

        // Only hotel owner or admin can mark as no-show
        if (booking.hotel.owner.toString() !== req.user._id.toString() &&
            req.user.role !== 'SUPER_ADMIN' &&
            req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'You are not authorized to perform this action' });
        }

        // Check if check-in time has passed
        const checkIn = new Date(booking.checkInDate);
        const now = new Date();

        if (now < checkIn) {
            return res.status(400).json({ error: 'Cannot mark as no-show before check-in date' });
        }

        booking.bookingStatus = 'NO_SHOW';
        await booking.save();

        // Restore room availability
        for (const roomData of booking.rooms) {
            await Room.findByIdAndUpdate(roomData.room, {
                $inc: { availableRooms: roomData.quantity }
            });
        }

        res.json({
            message: 'Booking marked as no-show',
            booking: {
                _id: booking._id,
                bookingNumber: booking.bookingNumber,
                bookingStatus: booking.bookingStatus
            }
        });

    } catch (error) {
        console.error('Mark no-show error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== REQUEST REFUND ====================
router.post('/bookings/:bookingId/refund-request', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { bookingId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(bookingId)) {
            return res.status(400).json({ error: 'Invalid booking ID' });
        }

        const booking = await Booking.findOne({
            _id: bookingId,
            user: req.user._id,
            bookingStatus: 'CANCELLED',
            'refund.isRefundRequested': false
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found or refund already requested' });
        }

        booking.refund.isRefundRequested = true;
        booking.refund.refundAmount = booking.pricing.finalAmount * 0.5; // Example: 50% refund
        booking.refund.refundStatus = 'PENDING';
        await booking.save();

        res.json({
            message: 'Refund request submitted successfully',
            refund: booking.refund
        });

    } catch (error) {
        console.error('Request refund error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: GET ALL BOOKINGS ====================
router.get('/admin/bookings', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            page = 1,
            limit = 10,
            search,
            status,
            hotelId,
            userId,
            startDate,
            endDate,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const query = {};

        // Search by booking number or user email/name
        if (search) {
            query.$or = [
                { bookingNumber: { $regex: search, $options: 'i' } },
                { 'user.Name': { $regex: search, $options: 'i' } },
                { 'user.email': { $regex: search, $options: 'i' } }
            ];
        }

        if (status && status !== 'all') {
            query.bookingStatus = status;
        }

        if (hotelId && mongoose.Types.ObjectId.isValid(hotelId)) {
            query.hotel = hotelId;
        }

        if (userId && mongoose.Types.ObjectId.isValid(userId)) {
            query.user = userId;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [bookings, totalCount] = await Promise.all([
            Booking.find(query)
                .populate('user', 'Name email phone')
                .populate('hotel', 'name slug owner')
                .populate('rooms.room', 'roomName roomNumber roomType')
                .populate('payment')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Booking.countDocuments(query)
        ]);

        // Calculate overall statistics
        const stats = await Booking.aggregate([
            { $match: query },
            {
                $group: {
                    _id: null,
                    totalBookings: { $sum: 1 },
                    totalRevenue: { $sum: '$pricing.finalAmount' },
                    totalPending: {
                        $sum: { $cond: [{ $eq: ['$bookingStatus', 'PENDING'] }, 1, 0] }
                    },
                    totalConfirmed: {
                        $sum: { $cond: [{ $eq: ['$bookingStatus', 'CONFIRMED'] }, 1, 0] }
                    },
                    totalCompleted: {
                        $sum: { $cond: [{ $eq: ['$bookingStatus', 'COMPLETED'] }, 1, 0] }
                    },
                    totalCancelled: {
                        $sum: { $cond: [{ $eq: ['$bookingStatus', 'CANCELLED'] }, 1, 0] }
                    },
                    totalCheckedIn: {
                        $sum: { $cond: [{ $eq: ['$bookingStatus', 'CHECKED_IN'] }, 1, 0] }
                    }
                }
            }
        ]);

        res.json({
            bookings,
            statistics: stats[0] || {
                totalBookings: 0,
                totalRevenue: 0,
                totalPending: 0,
                totalConfirmed: 0,
                totalCompleted: 0,
                totalCancelled: 0,
                totalCheckedIn: 0
            },
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalBookings: totalCount,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get all bookings admin error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: UPDATE BOOKING STATUS ====================
router.patch('/admin/bookings/:bookingId/status', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { bookingId } = req.params;
        const { bookingStatus } = req.body;

        if (!mongoose.Types.ObjectId.isValid(bookingId)) {
            return res.status(400).json({ error: 'Invalid booking ID' });
        }

        const validStatuses = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
        if (!validStatuses.includes(bookingStatus)) {
            return res.status(400).json({ error: 'Invalid booking status' });
        }

        const booking = await Booking.findById(bookingId);

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        booking.bookingStatus = bookingStatus;
        await booking.save();

        res.json({
            message: 'Booking status updated successfully',
            booking: {
                _id: booking._id,
                bookingNumber: booking.bookingNumber,
                bookingStatus: booking.bookingStatus
            }
        });

    } catch (error) {
        console.error('Update booking status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: DELETE BOOKING ====================
router.delete('/admin/bookings/:bookingId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { bookingId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(bookingId)) {
            return res.status(400).json({ error: 'Invalid booking ID' });
        }

        const booking = await Booking.findById(bookingId);

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        await Booking.findByIdAndDelete(bookingId);

        res.json({
            message: 'Booking deleted successfully',
            deletedBooking: {
                _id: booking._id,
                bookingNumber: booking.bookingNumber,
                bookingStatus: booking.bookingStatus
            }
        });

    } catch (error) {
        console.error('Delete booking error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: GET BOOKING STATISTICS ====================
router.get('/admin/bookings/statistics', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfYear = new Date(now.getFullYear(), 0, 1);

        const [
            totalBookings,
            pendingBookings,
            confirmedBookings,
            checkedInBookings,
            checkedOutBookings,
            completedBookings,
            cancelledBookings,
            noShowBookings,
            totalRevenue,
            dailyBookings,
            weeklyBookings,
            monthlyBookings,
            yearlyBookings,
            bookingsByHotel,
            bookingsByUser,
            revenueTrend,
            statusDistribution
        ] = await Promise.all([
            Booking.countDocuments(),
            Booking.countDocuments({ bookingStatus: 'PENDING' }),
            Booking.countDocuments({ bookingStatus: 'CONFIRMED' }),
            Booking.countDocuments({ bookingStatus: 'CHECKED_IN' }),
            Booking.countDocuments({ bookingStatus: 'CHECKED_OUT' }),
            Booking.countDocuments({ bookingStatus: 'COMPLETED' }),
            Booking.countDocuments({ bookingStatus: 'CANCELLED' }),
            Booking.countDocuments({ bookingStatus: 'NO_SHOW' }),
            Booking.aggregate([
                { $match: { bookingStatus: 'COMPLETED' } },
                { $group: { _id: null, total: { $sum: '$pricing.finalAmount' } } }
            ]),
            Booking.countDocuments({ createdAt: { $gte: startOfDay } }),
            Booking.countDocuments({ createdAt: { $gte: startOfWeek } }),
            Booking.countDocuments({ createdAt: { $gte: startOfMonth } }),
            Booking.countDocuments({ createdAt: { $gte: startOfYear } }),
            Booking.aggregate([
                { $group: { _id: '$hotel', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
                { $lookup: { from: 'hotels', localField: '_id', foreignField: '_id', as: 'hotel' } },
                { $unwind: '$hotel' }
            ]),
            Booking.aggregate([
                { $group: { _id: '$user', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
                { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
                { $unwind: '$user' }
            ]),
            Booking.aggregate([
                { $match: { bookingStatus: 'COMPLETED' } },
                { $group: {
                    _id: { month: { $month: '$createdAt' }, year: { $year: '$createdAt' } },
                    revenue: { $sum: '$pricing.finalAmount' },
                    count: { $sum: 1 }
                }},
                { $sort: { '_id.year': -1, '_id.month': -1 } },
                { $limit: 12 }
            ]),
            Booking.aggregate([
                { $group: { _id: '$bookingStatus', count: { $sum: 1 } } }
            ])
        ]);

        const activeBookings = confirmedBookings + checkedInBookings;
        const completionRate = totalBookings > 0 ? (completedBookings / totalBookings * 100).toFixed(1) : 0;
        const cancellationRate = totalBookings > 0 ? (cancelledBookings / totalBookings * 100).toFixed(1) : 0;

        res.json({
            overview: {
                totalBookings,
                activeBookings,
                pendingBookings,
                confirmedBookings,
                checkedInBookings,
                checkedOutBookings,
                completedBookings,
                cancelledBookings,
                noShowBookings,
                completionRate: parseFloat(completionRate),
                cancellationRate: parseFloat(cancellationRate),
                totalRevenue: totalRevenue[0]?.total || 0
            },
            statusDistribution,
            growth: {
                daily: dailyBookings,
                weekly: weeklyBookings,
                monthly: monthlyBookings,
                yearly: yearlyBookings
            },
            topPerformers: {
                topHotels: bookingsByHotel.map(item => ({
                    hotelId: item._id,
                    hotelName: item.hotel.name,
                    bookings: item.count
                })),
                topUsers: bookingsByUser.map(item => ({
                    userId: item._id,
                    userName: item.user.Name,
                    bookings: item.count
                }))
            },
            revenueTrend,
            timestamp: now
        });

    } catch (error) {
        console.error('Get booking statistics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: GET BOOKINGS BY DATE RANGE ====================
router.get('/admin/bookings/range', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { startDate, endDate, groupBy = 'day' } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Start date and end date are required' });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        if (start > end) {
            return res.status(400).json({ error: 'Start date must be before end date' });
        }

        let groupFormat;
        switch (groupBy) {
            case 'week':
                groupFormat = { week: { $week: '$createdAt' }, year: { $year: '$createdAt' } };
                break;
            case 'month':
                groupFormat = { month: { $month: '$createdAt' }, year: { $year: '$createdAt' } };
                break;
            case 'year':
                groupFormat = { year: { $year: '$createdAt' } };
                break;
            default:
                groupFormat = { day: { $dayOfMonth: '$createdAt' }, month: { $month: '$createdAt' }, year: { $year: '$createdAt' } };
        }

        const bookings = await Booking.aggregate([
            { $match: { createdAt: { $gte: start, $lte: end } } },
            {
                $group: {
                    _id: groupFormat,
                    totalBookings: { $sum: 1 },
                    totalRevenue: { $sum: '$pricing.finalAmount' },
                    completed: { $sum: { $cond: [{ $eq: ['$bookingStatus', 'COMPLETED'] }, 1, 0] } },
                    cancelled: { $sum: { $cond: [{ $eq: ['$bookingStatus', 'CANCELLED'] }, 1, 0] } },
                    confirmed: { $sum: { $cond: [{ $eq: ['$bookingStatus', 'CONFIRMED'] }, 1, 0] } }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
        ]);

        // Calculate summary
        const summary = await Booking.aggregate([
            { $match: { createdAt: { $gte: start, $lte: end } } },
            {
                $group: {
                    _id: null,
                    totalBookings: { $sum: 1 },
                    totalRevenue: { $sum: '$pricing.finalAmount' },
                    averageRevenue: { $avg: '$pricing.finalAmount' },
                    maxRevenue: { $max: '$pricing.finalAmount' },
                    minRevenue: { $min: '$pricing.finalAmount' }
                }
            }
        ]);

        res.json({
            dateRange: { startDate: start, endDate: end },
            groupBy,
            summary: summary[0] || {
                totalBookings: 0,
                totalRevenue: 0,
                averageRevenue: 0,
                maxRevenue: 0,
                minRevenue: 0
            },
            bookings: bookings
        });

    } catch (error) {
        console.error('Get bookings by date range error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;