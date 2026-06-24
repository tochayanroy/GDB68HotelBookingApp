const express = require('express');
const router = express.Router();
const passport = require('passport');
const mongoose = require('mongoose');
const crypto = require('crypto');

const Payment = require('../models/PaymentSchema.js');
const Booking = require('../models/BookingSchema.js');
const Hotel = require('../models/HotelSchema.js');
const User = require('../models/UserSchema.js');

// ==================== HELPER FUNCTIONS ====================

// Generate unique transaction ID
function generateTransactionId() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    const hash = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `TXN-${timestamp}-${random}-${hash}`;
}

// Generate unique gateway order ID
function generateGatewayOrderId() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `ORD-${timestamp}-${random}`;
}

// Calculate payment status based on gateway response
function determinePaymentStatus(gatewayResponse) {
    // This is a simplified example - actual implementation depends on gateway
    if (gatewayResponse.status === 'success' || gatewayResponse.status === 'captured') {
        return 'PAID';
    } else if (gatewayResponse.status === 'pending') {
        return 'PROCESSING';
    } else if (gatewayResponse.status === 'failed') {
        return 'FAILED';
    } else if (gatewayResponse.status === 'cancelled') {
        return 'CANCELLED';
    }
    return 'PENDING';
}

// Validate payment amount against booking amount
async function validatePaymentAmount(bookingId, amount) {
    const booking = await Booking.findById(bookingId);
    if (!booking) {
        return { valid: false, message: 'Booking not found' };
    }
    
    const expectedAmount = booking.pricing.finalAmount;
    if (amount !== expectedAmount) {
        return { 
            valid: false, 
            message: `Amount mismatch. Expected: ${expectedAmount}, Received: ${amount}` 
        };
    }
    
    return { valid: true, booking };
}

// ==================== INITIATE PAYMENT ====================
router.post('/payments/initiate', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const {
            bookingId,
            paymentMethod,
            gateway,
            amount,
            currency = 'INR'
        } = req.body;

        // Validate required fields
        if (!bookingId || !paymentMethod || !gateway || !amount) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate booking
        const booking = await Booking.findOne({
            _id: bookingId,
            user: req.user._id,
            bookingStatus: 'PENDING'
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found or already confirmed' });
        }

        // Validate amount
        const validation = await validatePaymentAmount(bookingId, amount);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.message });
        }

        // Check if payment already exists
        const existingPayment = await Payment.findOne({
            booking: bookingId,
            paymentStatus: { $in: ['PENDING', 'PROCESSING', 'PAID'] }
        });

        if (existingPayment) {
            return res.status(400).json({ 
                error: 'Payment already initiated for this booking',
                paymentId: existingPayment._id
            });
        }

        // Generate transaction IDs
        const transactionId = generateTransactionId();
        const gatewayOrderId = generateGatewayOrderId();

        // Create payment record
        const payment = new Payment({
            booking: bookingId,
            user: req.user._id,
            hotel: booking.hotel,
            amount,
            currency,
            paymentMethod,
            gateway,
            transactionId,
            gatewayOrderId,
            paymentStatus: 'PENDING',
            notes: `Payment initiated for booking ${booking.bookingNumber}`
        });

        await payment.save();

        // Populate payment details
        const populatedPayment = await Payment.findById(payment._id)
            .populate('booking', 'bookingNumber checkInDate checkOutDate totalNights')
            .populate('user', 'Name email phone')
            .populate('hotel', 'name slug');

        // In a real implementation, integrate with payment gateway here
        // Example: Razorpay, Stripe, PayPal integration

        res.status(201).json({
            message: 'Payment initiated successfully',
            payment: populatedPayment,
            gatewayOrderId: gatewayOrderId,
            // Add gateway-specific data for frontend integration
            gatewayData: {
                // This would be gateway-specific data
                // For example: Razorpay order ID, Stripe client secret, etc.
            }
        });

    } catch (error) {
        console.error('Initiate payment error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== CONFIRM PAYMENT ====================
router.post('/payments/confirm', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const {
            paymentId,
            gatewayPaymentId,
            gatewayResponse
        } = req.body;

        if (!paymentId || !gatewayPaymentId || !gatewayResponse) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const payment = await Payment.findOne({
            _id: paymentId,
            user: req.user._id,
            paymentStatus: 'PENDING'
        });

        if (!payment) {
            return res.status(404).json({ error: 'Payment not found or already processed' });
        }

        // Update payment with gateway response
        payment.gatewayPaymentId = gatewayPaymentId;
        payment.gatewayResponse = gatewayResponse;
        payment.paymentStatus = determinePaymentStatus(gatewayResponse);

        if (payment.paymentStatus === 'PAID') {
            payment.paidAt = new Date();
            payment.isVerified = true;
            payment.verifiedAt = new Date();
        }

        if (payment.paymentStatus === 'FAILED') {
            payment.failureReason = gatewayResponse.message || 'Payment failed';
        }

        await payment.save();

        // Update booking status if payment is successful
        if (payment.paymentStatus === 'PAID') {
            const booking = await Booking.findById(payment.booking);
            if (booking && booking.bookingStatus === 'PENDING') {
                booking.bookingStatus = 'CONFIRMED';
                booking.payment = payment._id;
                await booking.save();

                // Update room availability
                for (const roomData of booking.rooms) {
                    await Room.findByIdAndUpdate(roomData.room, {
                        $inc: { availableRooms: -roomData.quantity }
                    });
                }
            }
        }

        const populatedPayment = await Payment.findById(payment._id)
            .populate('booking', 'bookingNumber bookingStatus checkInDate checkOutDate')
            .populate('user', 'Name email phone')
            .populate('hotel', 'name slug');

        res.json({
            message: `Payment ${payment.paymentStatus.toLowerCase()}`,
            payment: populatedPayment,
            bookingStatus: payment.paymentStatus === 'PAID' ? 'CONFIRMED' : 'PENDING'
        });

    } catch (error) {
        console.error('Confirm payment error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET PAYMENT STATUS ====================
router.get('/payments/:paymentId/status', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { paymentId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(paymentId)) {
            return res.status(400).json({ error: 'Invalid payment ID' });
        }

        const payment = await Payment.findOne({
            _id: paymentId,
            user: req.user._id
        })
            .populate('booking', 'bookingNumber bookingStatus')
            .select('paymentStatus amount currency gateway gatewayTransactionId paidAt isVerified');

        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        res.json({
            paymentStatus: payment.paymentStatus,
            amount: payment.amount,
            currency: payment.currency,
            gateway: payment.gateway,
            transactionId: payment.transactionId,
            paidAt: payment.paidAt,
            isVerified: payment.isVerified
        });

    } catch (error) {
        console.error('Get payment status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET MY PAYMENTS ====================
router.get('/my-payments', passport.authenticate('jwt', { session: false }), async (req, res) => {
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
            query.paymentStatus = status;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [payments, totalCount] = await Promise.all([
            Payment.find(query)
                .populate('booking', 'bookingNumber checkInDate checkOutDate totalNights')
                .populate('hotel', 'name slug thumbnail')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Payment.countDocuments(query)
        ]);

        // Calculate summary
        const summary = await Payment.aggregate([
            { $match: { user: new mongoose.Types.ObjectId(req.user._id) } },
            {
                $group: {
                    _id: null,
                    totalPaid: {
                        $sum: {
                            $cond: [
                                { $in: ['$paymentStatus', ['PAID', 'PARTIALLY_REFUNDED']] },
                                '$amount',
                                0
                            ]
                        }
                    },
                    totalRefunded: {
                        $sum: {
                            $cond: [
                                { $in: ['$paymentStatus', ['REFUNDED', 'PARTIALLY_REFUNDED']] },
                                '$refund.refundAmount',
                                0
                            ]
                        }
                    },
                    totalPending: {
                        $sum: {
                            $cond: [
                                { $eq: ['$paymentStatus', 'PENDING'] },
                                '$amount',
                                0
                            ]
                        }
                    },
                    totalFailed: {
                        $sum: {
                            $cond: [
                                { $eq: ['$paymentStatus', 'FAILED'] },
                                '$amount',
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        res.json({
            payments,
            summary: summary[0] || {
                totalPaid: 0,
                totalRefunded: 0,
                totalPending: 0,
                totalFailed: 0
            },
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalPayments: totalCount,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get my payments error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET SINGLE PAYMENT ====================
router.get('/payments/:paymentId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { paymentId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(paymentId)) {
            return res.status(400).json({ error: 'Invalid payment ID' });
        }

        const payment = await Payment.findOne({
            _id: paymentId,
            user: req.user._id
        })
            .populate('booking', 'bookingNumber bookingStatus checkInDate checkOutDate totalNights pricing')
            .populate('hotel', 'name slug address starRating')
            .populate('user', 'Name email phone');

        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        res.json(payment);

    } catch (error) {
        console.error('Get single payment error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== REQUEST REFUND ====================
router.post('/payments/:paymentId/refund', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { paymentId } = req.params;
        const { refundReason, refundAmount } = req.body;

        if (!mongoose.Types.ObjectId.isValid(paymentId)) {
            return res.status(400).json({ error: 'Invalid payment ID' });
        }

        const payment = await Payment.findOne({
            _id: paymentId,
            user: req.user._id,
            paymentStatus: 'PAID',
            'refund.isRefunded': false
        });

        if (!payment) {
            return res.status(404).json({ error: 'Payment not found or cannot be refunded' });
        }

        // Calculate refund amount
        const maxRefund = payment.amount;
        const refundAmountToUse = refundAmount || maxRefund;

        if (refundAmountToUse > maxRefund) {
            return res.status(400).json({ 
                error: `Refund amount cannot exceed ${maxRefund}` 
            });
        }

        // Check if booking is cancelled
        const booking = await Booking.findById(payment.booking);
        if (!booking || booking.bookingStatus !== 'CANCELLED') {
            return res.status(400).json({ 
                error: 'Refund can only be processed for cancelled bookings' 
            });
        }

        // Update payment with refund
        payment.refund.isRefunded = true;
        payment.refund.refundAmount = refundAmountToUse;
        payment.refund.refundReason = refundReason || 'Refund requested by customer';
        payment.refund.refundTransactionId = generateTransactionId();
        payment.refund.refundedAt = new Date();

        if (refundAmountToUse === maxRefund) {
            payment.paymentStatus = 'REFUNDED';
        } else {
            payment.paymentStatus = 'PARTIALLY_REFUNDED';
        }

        await payment.save();

        // Update booking refund status
        booking.refund.isRefundRequested = true;
        booking.refund.refundAmount = refundAmountToUse;
        booking.refund.refundStatus = 'COMPLETED';
        await booking.save();

        res.json({
            message: 'Refund processed successfully',
            refund: {
                amount: refundAmountToUse,
                status: payment.paymentStatus,
                transactionId: payment.refund.refundTransactionId,
                refundedAt: payment.refund.refundedAt
            }
        });

    } catch (error) {
        console.error('Request refund error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET HOTEL PAYMENTS ====================
router.get('/hotel/:hotelId/payments', passport.authenticate('jwt', { session: false }), async (req, res) => {
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
            query.paymentStatus = status;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [payments, totalCount] = await Promise.all([
            Payment.find(query)
                .populate('booking', 'bookingNumber checkInDate checkOutDate guestDetails')
                .populate('user', 'Name email phone')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Payment.countDocuments(query)
        ]);

        // Calculate summary
        const summary = await Payment.aggregate([
            { $match: { hotel: new mongoose.Types.ObjectId(hotelId) } },
            {
                $group: {
                    _id: '$paymentStatus',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' }
                }
            }
        ]);

        res.json({
            hotel: {
                id: hotel._id,
                name: hotel.name
            },
            summary,
            payments,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalPayments: totalCount,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get hotel payments error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: GET ALL PAYMENTS ====================
router.get('/admin/payments', passport.authenticate('jwt', { session: false }), async (req, res) => {
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
            paymentMethod,
            gateway,
            startDate,
            endDate,
            minAmount,
            maxAmount,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const query = {};

        if (search) {
            query.$or = [
                { transactionId: { $regex: search, $options: 'i' } },
                { gatewayTransactionId: { $regex: search, $options: 'i' } }
            ];
        }

        if (status && status !== 'all') {
            query.paymentStatus = status;
        }

        if (hotelId && mongoose.Types.ObjectId.isValid(hotelId)) {
            query.hotel = hotelId;
        }

        if (userId && mongoose.Types.ObjectId.isValid(userId)) {
            query.user = userId;
        }

        if (paymentMethod && paymentMethod !== 'all') {
            query.paymentMethod = paymentMethod;
        }

        if (gateway && gateway !== 'all') {
            query.gateway = gateway;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        if (minAmount || maxAmount) {
            query.amount = {};
            if (minAmount) query.amount.$gte = parseFloat(minAmount);
            if (maxAmount) query.amount.$lte = parseFloat(maxAmount);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [payments, totalCount] = await Promise.all([
            Payment.find(query)
                .populate('booking', 'bookingNumber bookingStatus')
                .populate('user', 'Name email phone')
                .populate('hotel', 'name slug')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Payment.countDocuments(query)
        ]);

        // Calculate overall statistics
        const stats = await Payment.aggregate([
            { $match: query },
            {
                $group: {
                    _id: null,
                    totalPayments: { $sum: 1 },
                    totalAmount: { $sum: '$amount' },
                    totalRefunded: { $sum: '$refund.refundAmount' },
                    totalPaid: {
                        $sum: {
                            $cond: [
                                { $in: ['$paymentStatus', ['PAID', 'PARTIALLY_REFUNDED']] },
                                '$amount',
                                0
                            ]
                        }
                    },
                    totalPending: {
                        $sum: {
                            $cond: [{ $eq: ['$paymentStatus', 'PENDING'] }, '$amount', 0]
                        }
                    },
                    totalFailed: {
                        $sum: {
                            $cond: [{ $eq: ['$paymentStatus', 'FAILED'] }, '$amount', 0]
                        }
                    }
                }
            }
        ]);

        res.json({
            payments,
            statistics: stats[0] || {
                totalPayments: 0,
                totalAmount: 0,
                totalRefunded: 0,
                totalPaid: 0,
                totalPending: 0,
                totalFailed: 0
            },
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalPayments: totalCount,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get all payments admin error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: GET PAYMENT STATISTICS ====================
router.get('/admin/payments/statistics', passport.authenticate('jwt', { session: false }), async (req, res) => {
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
            totalPayments,
            totalAmount,
            paidPayments,
            pendingPayments,
            failedPayments,
            refundedPayments,
            partiallyRefundedPayments,
            dailyPayments,
            weeklyPayments,
            monthlyPayments,
            yearlyPayments,
            paymentsByMethod,
            paymentsByGateway,
            dailyRevenue,
            weeklyRevenue,
            monthlyRevenue,
            yearlyRevenue,
            averagePaymentAmount,
            highestPayment,
            lowestPayment
        ] = await Promise.all([
            Payment.countDocuments(),
            Payment.aggregate([
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Payment.countDocuments({ paymentStatus: 'PAID' }),
            Payment.countDocuments({ paymentStatus: 'PENDING' }),
            Payment.countDocuments({ paymentStatus: 'FAILED' }),
            Payment.countDocuments({ paymentStatus: 'REFUNDED' }),
            Payment.countDocuments({ paymentStatus: 'PARTIALLY_REFUNDED' }),
            Payment.countDocuments({ createdAt: { $gte: startOfDay } }),
            Payment.countDocuments({ createdAt: { $gte: startOfWeek } }),
            Payment.countDocuments({ createdAt: { $gte: startOfMonth } }),
            Payment.countDocuments({ createdAt: { $gte: startOfYear } }),
            Payment.aggregate([
                { $group: { _id: '$paymentMethod', count: { $sum: 1 } } }
            ]),
            Payment.aggregate([
                { $group: { _id: '$gateway', count: { $sum: 1 } } }
            ]),
            Payment.aggregate([
                { $match: { paymentStatus: 'PAID' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Payment.aggregate([
                { $match: { paymentStatus: 'PAID', createdAt: { $gte: startOfWeek } } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Payment.aggregate([
                { $match: { paymentStatus: 'PAID', createdAt: { $gte: startOfMonth } } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Payment.aggregate([
                { $match: { paymentStatus: 'PAID', createdAt: { $gte: startOfYear } } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Payment.aggregate([
                { $match: { paymentStatus: 'PAID' } },
                { $group: { _id: null, avg: { $avg: '$amount' } } }
            ]),
            Payment.findOne().sort({ amount: -1 }).select('amount user hotel'),
            Payment.findOne().sort({ amount: 1 }).select('amount user hotel')
        ]);

        const successRate = totalPayments > 0 
            ? ((paidPayments / totalPayments) * 100).toFixed(1)
            : 0;

        const refundRate = totalPayments > 0 
            ? (((refundedPayments + partiallyRefundedPayments) / totalPayments) * 100).toFixed(1)
            : 0;

        res.json({
            overview: {
                totalPayments,
                totalAmount: totalAmount[0]?.total || 0,
                paidPayments,
                pendingPayments,
                failedPayments,
                refundedPayments,
                partiallyRefundedPayments,
                successRate: parseFloat(successRate),
                refundRate: parseFloat(refundRate),
                averagePaymentAmount: averagePaymentAmount[0]?.avg.toFixed(2) || 0,
                highestPayment: highestPayment?.amount || 0,
                lowestPayment: lowestPayment?.amount || 0
            },
            growth: {
                daily: dailyPayments,
                weekly: weeklyPayments,
                monthly: monthlyPayments,
                yearly: yearlyPayments
            },
            revenue: {
                daily: dailyRevenue[0]?.total || 0,
                weekly: weeklyRevenue[0]?.total || 0,
                monthly: monthlyRevenue[0]?.total || 0,
                yearly: yearlyRevenue[0]?.total || 0
            },
            distribution: {
                byPaymentMethod: paymentsByMethod,
                byGateway: paymentsByGateway
            },
            timestamp: now
        });

    } catch (error) {
        console.error('Get payment statistics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: UPDATE PAYMENT STATUS ====================
router.patch('/admin/payments/:paymentId/status', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { paymentId } = req.params;
        const { paymentStatus, failureReason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(paymentId)) {
            return res.status(400).json({ error: 'Invalid payment ID' });
        }

        const validStatuses = ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'];
        if (!validStatuses.includes(paymentStatus)) {
            return res.status(400).json({ error: 'Invalid payment status' });
        }

        const payment = await Payment.findById(paymentId);

        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        payment.paymentStatus = paymentStatus;

        if (paymentStatus === 'PAID') {
            payment.paidAt = new Date();
            payment.isVerified = true;
            payment.verifiedAt = new Date();
        }

        if (paymentStatus === 'FAILED' && failureReason) {
            payment.failureReason = failureReason;
        }

        await payment.save();

        // Update booking if payment is confirmed
        if (paymentStatus === 'PAID') {
            const booking = await Booking.findById(payment.booking);
            if (booking && booking.bookingStatus === 'PENDING') {
                booking.bookingStatus = 'CONFIRMED';
                booking.payment = payment._id;
                await booking.save();

                // Update room availability
                for (const roomData of booking.rooms) {
                    await Room.findByIdAndUpdate(roomData.room, {
                        $inc: { availableRooms: -roomData.quantity }
                    });
                }
            }
        }

        const updatedPayment = await Payment.findById(paymentId)
            .populate('booking', 'bookingNumber')
            .populate('user', 'Name email');

        res.json({
            message: 'Payment status updated successfully',
            payment: updatedPayment
        });

    } catch (error) {
        console.error('Update payment status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: PROCESS REFUND ====================
router.post('/admin/payments/:paymentId/refund', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { paymentId } = req.params;
        const { refundAmount, refundReason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(paymentId)) {
            return res.status(400).json({ error: 'Invalid payment ID' });
        }

        const payment = await Payment.findById(paymentId);

        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        if (payment.paymentStatus !== 'PAID' && payment.paymentStatus !== 'PARTIALLY_REFUNDED') {
            return res.status(400).json({ error: 'Payment cannot be refunded' });
        }

        const maxRefund = payment.amount - payment.refund.refundAmount;
        const refundAmountToUse = refundAmount || maxRefund;

        if (refundAmountToUse > maxRefund) {
            return res.status(400).json({ 
                error: `Refund amount cannot exceed ${maxRefund}` 
            });
        }

        if (refundAmountToUse <= 0) {
            return res.status(400).json({ error: 'Refund amount must be greater than 0' });
        }

        // Update payment
        payment.refund.isRefunded = true;
        payment.refund.refundAmount = payment.refund.refundAmount + refundAmountToUse;
        payment.refund.refundReason = refundReason || 'Refund processed by admin';
        payment.refund.refundTransactionId = generateTransactionId();
        payment.refund.refundedAt = new Date();

        if (payment.refund.refundAmount === payment.amount) {
            payment.paymentStatus = 'REFUNDED';
        } else {
            payment.paymentStatus = 'PARTIALLY_REFUNDED';
        }

        await payment.save();

        // Update booking
        const booking = await Booking.findById(payment.booking);
        if (booking) {
            booking.refund.isRefundRequested = true;
            booking.refund.refundAmount = payment.refund.refundAmount;
            booking.refund.refundStatus = 'COMPLETED';
            await booking.save();
        }

        res.json({
            message: 'Refund processed successfully',
            refund: {
                amount: refundAmountToUse,
                totalRefunded: payment.refund.refundAmount,
                status: payment.paymentStatus,
                transactionId: payment.refund.refundTransactionId,
                refundedAt: payment.refund.refundedAt
            }
        });

    } catch (error) {
        console.error('Process refund error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: DELETE PAYMENT ====================
router.delete('/admin/payments/:paymentId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { paymentId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(paymentId)) {
            return res.status(400).json({ error: 'Invalid payment ID' });
        }

        const payment = await Payment.findById(paymentId);

        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        // Don't allow deletion of completed payments
        if (payment.paymentStatus === 'PAID' || payment.paymentStatus === 'REFUNDED') {
            return res.status(400).json({ 
                error: 'Cannot delete completed payments' 
            });
        }

        await Payment.findByIdAndDelete(paymentId);

        res.json({
            message: 'Payment deleted successfully',
            deletedPayment: {
                _id: payment._id,
                transactionId: payment.transactionId,
                amount: payment.amount
            }
        });

    } catch (error) {
        console.error('Delete payment error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== WEBHOOK FOR PAYMENT GATEWAY ====================
router.post('/webhook/payment', async (req, res) => {
    try {
        // This is a placeholder for payment gateway webhook
        // In production, implement proper webhook verification and validation
        const webhookData = req.body;
        const { gateway, gatewayPaymentId, gatewayOrderId, status, amount } = webhookData;

        // Find payment by gateway order ID
        const payment = await Payment.findOne({ gatewayOrderId });

        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        // Update payment based on webhook data
        payment.gatewayPaymentId = gatewayPaymentId;
        payment.gatewayResponse = webhookData;
        payment.paymentStatus = determinePaymentStatus({ status });

        if (payment.paymentStatus === 'PAID') {
            payment.paidAt = new Date();
            payment.isVerified = true;
            payment.verifiedAt = new Date();
        }

        await payment.save();

        // Update booking if payment is successful
        if (payment.paymentStatus === 'PAID') {
            const booking = await Booking.findById(payment.booking);
            if (booking && booking.bookingStatus === 'PENDING') {
                booking.bookingStatus = 'CONFIRMED';
                booking.payment = payment._id;
                await booking.save();

                // Update room availability
                for (const roomData of booking.rooms) {
                    await Room.findByIdAndUpdate(roomData.room, {
                        $inc: { availableRooms: -roomData.quantity }
                    });
                }
            }
        }

        res.json({ message: 'Webhook processed successfully' });

    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;