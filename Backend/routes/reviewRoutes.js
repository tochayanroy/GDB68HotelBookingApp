const express = require('express');
const router = express.Router();
const passport = require('passport');
const mongoose = require('mongoose');

const Review = require('../models/ReviewSchema.js');
const Hotel = require('../models/HotelSchema.js');
const Room = require('../models/RoomSchema.js');
const Booking = require('../models/BookingSchema.js');
const User = require('../models/UserSchema.js');

// ==================== HELPER FUNCTIONS ====================

// Update hotel average rating
async function updateHotelRating(hotelId) {
    const result = await Review.aggregate([
        { $match: { hotel: new mongoose.Types.ObjectId(hotelId), status: 'APPROVED' } },
        { $group: { 
            _id: null, 
            averageRating: { $avg: '$rating' },
            totalReviews: { $sum: 1 }
        }}
    ]);

    const avgRating = result[0]?.averageRating || 0;
    const totalReviews = result[0]?.totalReviews || 0;

    await Hotel.findByIdAndUpdate(hotelId, {
        averageRating: parseFloat(avgRating.toFixed(2)),
        totalReviews
    });

    return { averageRating: avgRating, totalReviews };
}

// Update room average rating
async function updateRoomRating(roomId) {
    if (!roomId) return;

    const result = await Review.aggregate([
        { $match: { room: new mongoose.Types.ObjectId(roomId), status: 'APPROVED' } },
        { $group: { 
            _id: null, 
            averageRating: { $avg: '$rating' },
            totalReviews: { $sum: 1 }
        }}
    ]);

    const avgRating = result[0]?.averageRating || 0;
    const totalReviews = result[0]?.totalReviews || 0;

    await Room.findByIdAndUpdate(roomId, {
        averageRating: parseFloat(avgRating.toFixed(2)),
        totalReviews
    });
}

// Check if user has completed booking for hotel
async function hasCompletedBooking(userId, hotelId, bookingId) {
    const booking = await Booking.findOne({
        _id: bookingId,
        user: userId,
        hotel: hotelId,
        bookingStatus: 'COMPLETED'
    });

    return !!booking;
}

// ==================== CREATE REVIEW ====================
router.post('/reviews', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const {
            hotelId,
            bookingId,
            roomId,
            rating,
            title,
            comment
        } = req.body;

        // Validate required fields
        if (!hotelId || !bookingId || !rating || !comment) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate rating
        if (rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5' });
        }

        // Check if hotel exists
        const hotel = await Hotel.findOne({ _id: hotelId, isActive: true });
        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        // Check if user has completed booking
        const hasCompleted = await hasCompletedBooking(req.user._id, hotelId, bookingId);
        if (!hasCompleted) {
            return res.status(403).json({ 
                error: 'You can only review completed bookings' 
            });
        }

        // Check if user already reviewed this booking
        const existingReview = await Review.findOne({
            user: req.user._id,
            booking: bookingId
        });

        if (existingReview) {
            return res.status(400).json({ error: 'You have already reviewed this booking' });
        }

        // Verify room if provided
        if (roomId) {
            const room = await Room.findOne({ _id: roomId, hotel: hotelId });
            if (!room) {
                return res.status(404).json({ error: 'Room not found in this hotel' });
            }
        }

        // Create review
        const review = new Review({
            user: req.user._id,
            hotel: hotelId,
            booking: bookingId,
            room: roomId || null,
            rating,
            title: title || '',
            comment,
            isVerifiedStay: true,
            status: 'PENDING'
        });

        await review.save();

        res.status(201).json({
            message: 'Review submitted successfully. Waiting for moderation.',
            review
        });

    } catch (error) {
        console.error('Create review error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET HOTEL REVIEWS ====================
router.get('/hotels/:hotelId/reviews', async (req, res) => {
    try {
        const { hotelId } = req.params;
        const {
            page = 1,
            limit = 10,
            rating,
            sortBy = 'createdAt',
            sortOrder = 'desc',
            status = 'APPROVED'
        } = req.query;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const query = {
            hotel: hotelId,
            status: status
        };

        if (rating) {
            query.rating = parseInt(rating);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [reviews, totalCount] = await Promise.all([
            Review.find(query)
                .populate('user', 'Name profileImage')
                .populate('room', 'roomName roomNumber')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Review.countDocuments(query)
        ]);

        // Get rating distribution
        const ratingDistribution = await Review.aggregate([
            { $match: { hotel: new mongoose.Types.ObjectId(hotelId), status: 'APPROVED' } },
            { $group: { _id: '$rating', count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]);

        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        ratingDistribution.forEach(item => {
            distribution[item._id] = item.count;
        });

        // Get hotel stats
        const hotelStats = await Hotel.findById(hotelId)
            .select('averageRating totalReviews');

        res.json({
            hotel: {
                id: hotelId,
                averageRating: hotelStats?.averageRating || 0,
                totalReviews: hotelStats?.totalReviews || 0
            },
            ratingDistribution: distribution,
            reviews,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalReviews: totalCount,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get hotel reviews error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ROOM REVIEWS ====================
router.get('/rooms/:roomId/reviews', async (req, res) => {
    try {
        const { roomId } = req.params;
        const {
            page = 1,
            limit = 10,
            rating,
            sortBy = 'createdAt',
            sortOrder = 'desc',
            status = 'APPROVED'
        } = req.query;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const query = {
            room: roomId,
            status: status
        };

        if (rating) {
            query.rating = parseInt(rating);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [reviews, totalCount] = await Promise.all([
            Review.find(query)
                .populate('user', 'Name profileImage')
                .populate('hotel', 'name slug')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Review.countDocuments(query)
        ]);

        // Get room stats
        const roomStats = await Room.findById(roomId)
            .select('averageRating totalReviews');

        res.json({
            room: {
                id: roomId,
                averageRating: roomStats?.averageRating || 0,
                totalReviews: roomStats?.totalReviews || 0
            },
            reviews,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalReviews: totalCount,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get room reviews error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET MY REVIEWS ====================
router.get('/my-reviews', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            status,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const query = { user: req.user._id };

        if (status && status !== 'all') {
            query.status = status;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [reviews, totalCount] = await Promise.all([
            Review.find(query)
                .populate('hotel', 'name slug thumbnail')
                .populate('room', 'roomName roomNumber')
                .populate('booking', 'bookingNumber checkInDate checkOutDate')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Review.countDocuments(query)
        ]);

        res.json({
            reviews,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalReviews: totalCount,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get my reviews error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET SINGLE REVIEW ====================
router.get('/reviews/:reviewId', async (req, res) => {
    try {
        const { reviewId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const review = await Review.findOne({
            _id: reviewId,
            status: 'APPROVED'
        })
            .populate('user', 'Name profileImage')
            .populate('hotel', 'name slug address starRating')
            .populate('room', 'roomName roomNumber')
            .populate('adminReply.repliedBy', 'Name email')
            .populate('booking', 'bookingNumber checkInDate checkOutDate');

        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        res.json(review);

    } catch (error) {
        console.error('Get single review error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE REVIEW ====================
router.put('/reviews/:reviewId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { reviewId } = req.params;
        const { rating, title, comment } = req.body;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const review = await Review.findOne({
            _id: reviewId,
            user: req.user._id,
            status: { $in: ['PENDING', 'APPROVED'] }
        });

        if (!review) {
            return res.status(404).json({ error: 'Review not found or cannot be edited' });
        }

        // Don't allow editing approved reviews if they've been approved for more than 7 days
        if (review.status === 'APPROVED') {
            const daysSinceApproval = (Date.now() - review.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceApproval > 7) {
                return res.status(400).json({ 
                    error: 'Reviews cannot be edited after 7 days of approval' 
                });
            }
        }

        // Update review
        if (rating) {
            if (rating < 1 || rating > 5) {
                return res.status(400).json({ error: 'Rating must be between 1 and 5' });
            }
            review.rating = rating;
        }

        if (title !== undefined) {
            review.title = title;
        }

        if (comment) {
            review.comment = comment;
        }

        review.isEdited = true;

        await review.save();

        // Update hotel and room ratings if review is approved
        if (review.status === 'APPROVED') {
            await updateHotelRating(review.hotel);
            if (review.room) {
                await updateRoomRating(review.room);
            }
        }

        const updatedReview = await Review.findById(reviewId)
            .populate('user', 'Name profileImage')
            .populate('hotel', 'name slug');

        res.json({
            message: 'Review updated successfully',
            review: updatedReview
        });

    } catch (error) {
        console.error('Update review error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DELETE REVIEW ====================
router.delete('/reviews/:reviewId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { reviewId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const review = await Review.findOne({
            _id: reviewId,
            user: req.user._id
        });

        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        // Don't allow deletion of approved reviews older than 30 days
        if (review.status === 'APPROVED') {
            const daysSinceApproval = (Date.now() - review.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceApproval > 30) {
                return res.status(400).json({ 
                    error: 'Reviews cannot be deleted after 30 days of approval' 
                });
            }
        }

        await Review.findByIdAndDelete(reviewId);

        // Update hotel and room ratings
        await updateHotelRating(review.hotel);
        if (review.room) {
            await updateRoomRating(review.room);
        }

        res.json({
            message: 'Review deleted successfully',
            deletedReview: {
                _id: review._id,
                hotel: review.hotel,
                rating: review.rating
            }
        });

    } catch (error) {
        console.error('Delete review error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== MARK REVIEW HELPFUL ====================
router.post('/reviews/:reviewId/helpful', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { reviewId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const review = await Review.findOne({
            _id: reviewId,
            status: 'APPROVED'
        });

        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        // Check if user already marked helpful
        const alreadyHelped = review.helpfulBy.includes(req.user._id);

        if (alreadyHelped) {
            // Remove helpful vote
            review.helpfulBy = review.helpfulBy.filter(
                id => id.toString() !== req.user._id.toString()
            );
            review.helpfulCount = review.helpfulBy.length;
            await review.save();

            return res.json({
                message: 'Removed helpful vote',
                helpfulCount: review.helpfulCount,
                isHelpful: false
            });
        } else {
            // Add helpful vote
            review.helpfulBy.push(req.user._id);
            review.helpfulCount = review.helpfulBy.length;
            await review.save();

            return res.json({
                message: 'Marked review as helpful',
                helpfulCount: review.helpfulCount,
                isHelpful: true
            });
        }

    } catch (error) {
        console.error('Mark review helpful error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: GET ALL REVIEWS ====================
router.get('/admin/reviews', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            page = 1,
            limit = 10,
            search,
            status,
            rating,
            hotelId,
            userId,
            roomId,
            startDate,
            endDate,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const query = {};

        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { comment: { $regex: search, $options: 'i' } }
            ];
        }

        if (status && status !== 'all') {
            query.status = status;
        }

        if (rating) {
            query.rating = parseInt(rating);
        }

        if (hotelId && mongoose.Types.ObjectId.isValid(hotelId)) {
            query.hotel = hotelId;
        }

        if (userId && mongoose.Types.ObjectId.isValid(userId)) {
            query.user = userId;
        }

        if (roomId && mongoose.Types.ObjectId.isValid(roomId)) {
            query.room = roomId;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [reviews, totalCount] = await Promise.all([
            Review.find(query)
                .populate('user', 'Name email profileImage')
                .populate('hotel', 'name slug owner')
                .populate('room', 'roomName roomNumber')
                .populate('booking', 'bookingNumber')
                .populate('adminReply.repliedBy', 'Name email')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Review.countDocuments(query)
        ]);

        // Get statistics
        const stats = await Review.aggregate([
            { $match: query },
            {
                $group: {
                    _id: null,
                    totalReviews: { $sum: 1 },
                    averageRating: { $avg: '$rating' },
                    pending: {
                        $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] }
                    },
                    approved: {
                        $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] }
                    },
                    rejected: {
                        $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] }
                    },
                    hidden: {
                        $sum: { $cond: [{ $eq: ['$status', 'HIDDEN'] }, 1, 0] }
                    }
                }
            }
        ]);

        res.json({
            reviews,
            statistics: stats[0] || {
                totalReviews: 0,
                averageRating: 0,
                pending: 0,
                approved: 0,
                rejected: 0,
                hidden: 0
            },
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalReviews: totalCount,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get all reviews admin error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: GET PENDING REVIEWS ====================
router.get('/admin/reviews/pending', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            page = 1,
            limit = 10,
            sortBy = 'createdAt',
            sortOrder = 'asc'
        } = req.query;

        const query = { status: 'PENDING' };

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [reviews, totalCount] = await Promise.all([
            Review.find(query)
                .populate('user', 'Name email profileImage')
                .populate('hotel', 'name slug')
                .populate('room', 'roomName roomNumber')
                .populate('booking', 'bookingNumber')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Review.countDocuments(query)
        ]);

        res.json({
            pendingReviews: reviews,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalPending: totalCount,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get pending reviews error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: APPROVE REVIEW ====================
router.patch('/admin/reviews/:reviewId/approve', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { reviewId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const review = await Review.findOne({
            _id: reviewId,
            status: 'PENDING'
        });

        if (!review) {
            return res.status(404).json({ error: 'Review not found or already processed' });
        }

        review.status = 'APPROVED';
        await review.save();

        // Update hotel and room ratings
        await updateHotelRating(review.hotel);
        if (review.room) {
            await updateRoomRating(review.room);
        }

        const updatedReview = await Review.findById(reviewId)
            .populate('user', 'Name email')
            .populate('hotel', 'name');

        res.json({
            message: 'Review approved successfully',
            review: updatedReview
        });

    } catch (error) {
        console.error('Approve review error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: REJECT REVIEW ====================
router.patch('/admin/reviews/:reviewId/reject', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { reviewId } = req.params;
        const { rejectionReason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const review = await Review.findOne({
            _id: reviewId,
            status: 'PENDING'
        });

        if (!review) {
            return res.status(404).json({ error: 'Review not found or already processed' });
        }

        review.status = 'REJECTED';
        review.adminReply = {
            message: rejectionReason || 'Review rejected by admin',
            repliedBy: req.user._id,
            repliedAt: new Date()
        };
        await review.save();

        res.json({
            message: 'Review rejected successfully',
            review: {
                _id: review._id,
                status: review.status,
                rejectionReason: review.adminReply.message
            }
        });

    } catch (error) {
        console.error('Reject review error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: HIDE REVIEW ====================
router.patch('/admin/reviews/:reviewId/hide', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { reviewId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const review = await Review.findOne({
            _id: reviewId,
            status: 'APPROVED'
        });

        if (!review) {
            return res.status(404).json({ error: 'Review not found or already hidden' });
        }

        review.status = 'HIDDEN';
        await review.save();

        // Update hotel and room ratings
        await updateHotelRating(review.hotel);
        if (review.room) {
            await updateRoomRating(review.room);
        }

        res.json({
            message: 'Review hidden successfully',
            review: {
                _id: review._id,
                status: review.status
            }
        });

    } catch (error) {
        console.error('Hide review error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: UNHIDE REVIEW ====================
router.patch('/admin/reviews/:reviewId/unhide', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { reviewId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const review = await Review.findOne({
            _id: reviewId,
            status: 'HIDDEN'
        });

        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        review.status = 'APPROVED';
        await review.save();

        // Update hotel and room ratings
        await updateHotelRating(review.hotel);
        if (review.room) {
            await updateRoomRating(review.room);
        }

        res.json({
            message: 'Review unhidden successfully',
            review: {
                _id: review._id,
                status: review.status
            }
        });

    } catch (error) {
        console.error('Unhide review error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: REPLY TO REVIEW ====================
router.post('/admin/reviews/:reviewId/reply', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { reviewId } = req.params;
        const { message } = req.body;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        if (!message) {
            return res.status(400).json({ error: 'Reply message is required' });
        }

        const review = await Review.findById(reviewId);

        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        review.adminReply = {
            message,
            repliedBy: req.user._id,
            repliedAt: new Date()
        };

        await review.save();

        const updatedReview = await Review.findById(reviewId)
            .populate('adminReply.repliedBy', 'Name email');

        res.json({
            message: 'Reply added successfully',
            reply: updatedReview.adminReply
        });

    } catch (error) {
        console.error('Reply to review error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: UPDATE REPLY ====================
router.put('/admin/reviews/:reviewId/reply', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { reviewId } = req.params;
        const { message } = req.body;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        if (!message) {
            return res.status(400).json({ error: 'Reply message is required' });
        }

        const review = await Review.findById(reviewId);

        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        if (!review.adminReply) {
            return res.status(400).json({ error: 'No reply exists to update' });
        }

        review.adminReply.message = message;
        review.adminReply.repliedAt = new Date();

        await review.save();

        res.json({
            message: 'Reply updated successfully',
            reply: review.adminReply
        });

    } catch (error) {
        console.error('Update reply error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: DELETE REPLY ====================
router.delete('/admin/reviews/:reviewId/reply', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { reviewId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const review = await Review.findById(reviewId);

        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        review.adminReply = undefined;
        await review.save();

        res.json({
            message: 'Reply deleted successfully'
        });

    } catch (error) {
        console.error('Delete reply error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: DELETE REVIEW ====================
router.delete('/admin/reviews/:reviewId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { reviewId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const review = await Review.findById(reviewId);

        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        await Review.findByIdAndDelete(reviewId);

        // Update hotel and room ratings
        await updateHotelRating(review.hotel);
        if (review.room) {
            await updateRoomRating(review.room);
        }

        res.json({
            message: 'Review permanently deleted',
            deletedReview: {
                _id: review._id,
                user: review.user,
                hotel: review.hotel,
                rating: review.rating
            }
        });

    } catch (error) {
        console.error('Delete review admin error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET REVIEW STATISTICS ====================
router.get('/admin/reviews/statistics', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfYear = new Date(now.getFullYear(), 0, 1);

        const [
            totalReviews,
            averageRating,
            ratingDistribution,
            statusDistribution,
            monthlyReviews,
            yearlyReviews,
            topReviewedHotels,
            topReviewers,
            reviewsWithHelpful,
            reviewsWithReplies
        ] = await Promise.all([
            Review.countDocuments(),
            Review.aggregate([
                { $group: { _id: null, avg: { $avg: '$rating' } } }
            ]),
            Review.aggregate([
                { $group: { _id: '$rating', count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ]),
            Review.aggregate([
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            Review.countDocuments({ createdAt: { $gte: startOfMonth } }),
            Review.countDocuments({ createdAt: { $gte: startOfYear } }),
            Review.aggregate([
                { $match: { status: 'APPROVED' } },
                { $group: { _id: '$hotel', count: { $sum: 1 }, avgRating: { $avg: '$rating' } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
                { $lookup: { from: 'hotels', localField: '_id', foreignField: '_id', as: 'hotel' } },
                { $unwind: '$hotel' }
            ]),
            Review.aggregate([
                { $match: { status: 'APPROVED' } },
                { $group: { _id: '$user', count: { $sum: 1 }, avgRating: { $avg: '$rating' } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
                { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
                { $unwind: '$user' }
            ]),
            Review.countDocuments({ helpfulCount: { $gt: 0 } }),
            Review.countDocuments({ 'adminReply.message': { $exists: true } })
        ]);

        const avgRating = averageRating[0]?.avg || 0;
        const ratingDistributionMap = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        ratingDistribution.forEach(item => {
            ratingDistributionMap[item._id] = item.count;
        });

        const statusDistributionMap = {
            PENDING: 0,
            APPROVED: 0,
            REJECTED: 0,
            HIDDEN: 0
        };
        statusDistribution.forEach(item => {
            statusDistributionMap[item._id] = item.count;
        });

        const approvalRate = totalReviews > 0 
            ? ((statusDistributionMap.APPROVED / totalReviews) * 100).toFixed(1)
            : 0;

        res.json({
            overview: {
                totalReviews,
                averageRating: parseFloat(avgRating.toFixed(2)),
                approvalRate: parseFloat(approvalRate),
                reviewsWithHelpful,
                reviewsWithReplies
            },
            distribution: {
                byRating: ratingDistributionMap,
                byStatus: statusDistributionMap
            },
            growth: {
                monthly: monthlyReviews,
                yearly: yearlyReviews
            },
            topPerformers: {
                topReviewedHotels: topReviewedHotels.map(item => ({
                    hotelId: item._id,
                    hotelName: item.hotel.name,
                    reviews: item.count,
                    averageRating: item.avgRating
                })),
                topReviewers: topReviewers.map(item => ({
                    userId: item._id,
                    userName: item.user.Name,
                    reviews: item.count,
                    averageRating: item.avgRating
                }))
            },
            timestamp: now
        });

    } catch (error) {
        console.error('Get review statistics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;