const express = require('express');
const router = express.Router();
const passport = require('passport');
const mongoose = require('mongoose');
const moment = require('moment');

const Coupon = require('../models/CouponSchema.js');
const Booking = require('../models/BookingSchema.js');
const Hotel = require('../models/HotelSchema.js');
const Room = require('../models/RoomSchema.js');

// ==================== HELPER FUNCTIONS ====================

// Generate unique coupon code
function generateCouponCode(title) {
    const prefix = title.substring(0, 3).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    const timestamp = Date.now().toString(36).substring(4, 8).toUpperCase();
    return `${prefix}${random}${timestamp}`;
}

// Check if coupon is valid
async function validateCoupon(couponId, userId, bookingAmount, hotelId, roomIds) {
    const coupon = await Coupon.findById(couponId)
        .populate('hotels')
        .populate('rooms');

    if (!coupon) {
        return { valid: false, message: 'Coupon not found' };
    }

    // Check if coupon is active
    if (!coupon.isActive) {
        return { valid: false, message: 'Coupon is not active' };
    }

    // Check validity dates
    const now = new Date();
    if (now < coupon.startDate || now > coupon.endDate) {
        return { valid: false, message: 'Coupon has expired or not yet active' };
    }

    // Check total usage limit
    if (coupon.totalUsageLimit && coupon.totalUsed >= coupon.totalUsageLimit) {
        return { valid: false, message: 'Coupon usage limit has been reached' };
    }

    // Check per user usage limit
    const userUsage = coupon.usedBy.filter(u => u.user.toString() === userId.toString());
    if (userUsage.length >= coupon.perUserUsageLimit) {
        return { valid: false, message: 'You have already used this coupon' };
    }

    // Check first booking only
    if (coupon.firstBookingOnly) {
        const userBookings = await Booking.countDocuments({ user: userId, bookingStatus: 'COMPLETED' });
        if (userBookings > 0) {
            return { valid: false, message: 'This coupon is only for first-time bookings' };
        }
    }

    // Check minimum booking amount
    if (bookingAmount < coupon.minimumBookingAmount) {
        return { 
            valid: false, 
            message: `Minimum booking amount of ${coupon.minimumBookingAmount} is required` 
        };
    }

    // Check applies to scope
    if (coupon.appliesTo === 'SPECIFIC_HOTELS') {
        const hotelIds = coupon.hotels.map(h => h._id.toString());
        if (!hotelIds.includes(hotelId.toString())) {
            return { valid: false, message: 'Coupon does not apply to this hotel' };
        }
    }

    if (coupon.appliesTo === 'SPECIFIC_ROOMS') {
        const couponRoomIds = coupon.rooms.map(r => r._id.toString());
        const hasMatchingRoom = roomIds.some(rid => couponRoomIds.includes(rid.toString()));
        if (!hasMatchingRoom) {
            return { valid: false, message: 'Coupon does not apply to these rooms' };
        }
    }

    // Check user eligibility
    if (coupon.userEligibility === 'NEW_USERS') {
        const userBookings = await Booking.countDocuments({ user: userId, bookingStatus: 'COMPLETED' });
        if (userBookings > 0) {
            return { valid: false, message: 'This coupon is only for new users' };
        }
    }

    if (coupon.userEligibility === 'EXISTING_USERS') {
        const userBookings = await Booking.countDocuments({ user: userId, bookingStatus: 'COMPLETED' });
        if (userBookings === 0) {
            return { valid: false, message: 'This coupon is only for existing users' };
        }
    }

    // Calculate discount
    let discountAmount = 0;
    if (coupon.discountType === 'PERCENTAGE') {
        discountAmount = (bookingAmount * coupon.discountValue) / 100;
        if (coupon.maxDiscountAmount && discountAmount > coupon.maxDiscountAmount) {
            discountAmount = coupon.maxDiscountAmount;
        }
    } else {
        discountAmount = Math.min(coupon.discountValue, bookingAmount);
    }

    return {
        valid: true,
        coupon,
        discountAmount: parseFloat(discountAmount.toFixed(2)),
        finalAmount: parseFloat((bookingAmount - discountAmount).toFixed(2))
    };
}

// ==================== CREATE COUPON ====================
router.post('/coupons', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can create coupons
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const {
            title,
            description,
            discountType,
            discountValue,
            maxDiscountAmount,
            minimumBookingAmount,
            appliesTo,
            hotels,
            rooms,
            userEligibility,
            totalUsageLimit,
            perUserUsageLimit,
            startDate,
            endDate,
            firstBookingOnly
        } = req.body;

        // Validate required fields
        if (!title || !discountType || !discountValue || !startDate || !endDate) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate dates
        const start = new Date(startDate);
        const end = new Date(endDate);

        if (start >= end) {
            return res.status(400).json({ error: 'End date must be after start date' });
        }

        if (start < new Date()) {
            return res.status(400).json({ error: 'Start date cannot be in the past' });
        }

        // Validate discount value
        if (discountValue <= 0) {
            return res.status(400).json({ error: 'Discount value must be greater than 0' });
        }

        if (discountType === 'PERCENTAGE' && discountValue > 100) {
            return res.status(400).json({ error: 'Percentage discount cannot exceed 100%' });
        }

        // Validate appliesTo
        if (appliesTo === 'SPECIFIC_HOTELS' && (!hotels || hotels.length === 0)) {
            return res.status(400).json({ error: 'Please specify hotels for this coupon' });
        }

        if (appliesTo === 'SPECIFIC_ROOMS' && (!rooms || rooms.length === 0)) {
            return res.status(400).json({ error: 'Please specify rooms for this coupon' });
        }

        // Generate unique coupon code
        const code = generateCouponCode(title);

        // Check if code already exists
        let existingCoupon = await Coupon.findOne({ code });
        let counter = 1;
        while (existingCoupon) {
            const newCode = `${code}${counter}`;
            existingCoupon = await Coupon.findOne({ code: newCode });
            if (!existingCoupon) {
                break;
            }
            counter++;
        }
        const finalCode = existingCoupon ? `${code}${counter}` : code;

        // Create coupon
        const coupon = new Coupon({
            code: finalCode,
            title,
            description: description || '',
            discountType,
            discountValue,
            maxDiscountAmount: maxDiscountAmount || null,
            minimumBookingAmount: minimumBookingAmount || 0,
            appliesTo: appliesTo || 'ALL_HOTELS',
            hotels: appliesTo === 'SPECIFIC_HOTELS' ? hotels : [],
            rooms: appliesTo === 'SPECIFIC_ROOMS' ? rooms : [],
            userEligibility: userEligibility || 'ALL_USERS',
            totalUsageLimit: totalUsageLimit || null,
            perUserUsageLimit: perUserUsageLimit || 1,
            startDate: start,
            endDate: end,
            firstBookingOnly: firstBookingOnly || false,
            createdBy: req.user._id,
            isActive: true
        });

        await coupon.save();

        const populatedCoupon = await Coupon.findById(coupon._id)
            .populate('hotels', 'name slug')
            .populate('rooms', 'roomName roomNumber')
            .populate('createdBy', 'Name email');

        res.status(201).json({
            message: 'Coupon created successfully',
            coupon: populatedCoupon
        });

    } catch (error) {
        console.error('Create coupon error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ALL COUPONS ====================
router.get('/coupons', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view all coupons
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            page = 1,
            limit = 10,
            search,
            isActive,
            discountType,
            appliesTo,
            startDate,
            endDate,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const query = {};

        if (search) {
            query.$or = [
                { code: { $regex: search, $options: 'i' } },
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }

        if (discountType && discountType !== 'all') {
            query.discountType = discountType;
        }

        if (appliesTo && appliesTo !== 'all') {
            query.appliesTo = appliesTo;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [coupons, totalCount] = await Promise.all([
            Coupon.find(query)
                .populate('hotels', 'name slug')
                .populate('rooms', 'roomName roomNumber')
                .populate('createdBy', 'Name email')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Coupon.countDocuments(query)
        ]);

        res.json({
            coupons,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalCoupons: totalCount,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get all coupons error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ACTIVE COUPONS ====================
router.get('/coupons/active', async (req, res) => {
    try {
        const now = new Date();

        const coupons = await Coupon.find({
            isActive: true,
            startDate: { $lte: now },
            endDate: { $gte: now }
        })
            .select('code title description discountType discountValue maxDiscountAmount minimumBookingAmount appliesTo')
            .limit(20);

        res.json({
            activeCoupons: coupons,
            count: coupons.length
        });

    } catch (error) {
        console.error('Get active coupons error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET SINGLE COUPON ====================
router.get('/coupons/:couponId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { couponId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(couponId)) {
            return res.status(400).json({ error: 'Invalid coupon ID' });
        }

        const coupon = await Coupon.findById(couponId)
            .populate('hotels', 'name slug address starRating')
            .populate('rooms', 'roomName roomNumber roomType pricePerNight')
            .populate('createdBy', 'Name email')
            .populate('usedBy.user', 'Name email');

        if (!coupon) {
            return res.status(404).json({ error: 'Coupon not found' });
        }

        // Check if user can view this coupon
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json(coupon);

    } catch (error) {
        console.error('Get single coupon error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET COUPON BY CODE ====================
router.get('/coupons/code/:code', async (req, res) => {
    try {
        const { code } = req.params;

        const coupon = await Coupon.findOne({
            code: code.toUpperCase(),
            isActive: true
        })
            .populate('hotels', 'name slug')
            .populate('rooms', 'roomName roomNumber');

        if (!coupon) {
            return res.status(404).json({ error: 'Coupon not found or inactive' });
        }

        // Check if coupon is valid
        const now = new Date();
        if (now < coupon.startDate || now > coupon.endDate) {
            return res.status(400).json({ error: 'Coupon is not valid at this time' });
        }

        res.json({
            coupon: {
                code: coupon.code,
                title: coupon.title,
                description: coupon.description,
                discountType: coupon.discountType,
                discountValue: coupon.discountValue,
                maxDiscountAmount: coupon.maxDiscountAmount,
                minimumBookingAmount: coupon.minimumBookingAmount,
                appliesTo: coupon.appliesTo,
                firstBookingOnly: coupon.firstBookingOnly
            }
        });

    } catch (error) {
        console.error('Get coupon by code error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== VALIDATE COUPON ====================
router.post('/coupons/validate', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { couponCode, bookingAmount, hotelId, roomIds } = req.body;

        if (!couponCode || !bookingAmount || !hotelId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const coupon = await Coupon.findOne({
            code: couponCode.toUpperCase()
        });

        if (!coupon) {
            return res.status(404).json({ error: 'Coupon not found' });
        }

        const validationResult = await validateCoupon(
            coupon._id,
            req.user._id,
            bookingAmount,
            hotelId,
            roomIds || []
        );

        if (!validationResult.valid) {
            return res.status(400).json({ 
                error: validationResult.message 
            });
        }

        res.json({
            valid: true,
            coupon: {
                code: coupon.code,
                title: coupon.title,
                discountType: coupon.discountType,
                discountValue: coupon.discountValue
            },
            discountAmount: validationResult.discountAmount,
            finalAmount: validationResult.finalAmount
        });

    } catch (error) {
        console.error('Validate coupon error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE COUPON ====================
router.put('/coupons/:couponId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can update coupons
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { couponId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(couponId)) {
            return res.status(400).json({ error: 'Invalid coupon ID' });
        }

        const coupon = await Coupon.findById(couponId);

        if (!coupon) {
            return res.status(404).json({ error: 'Coupon not found' });
        }

        const {
            title,
            description,
            discountType,
            discountValue,
            maxDiscountAmount,
            minimumBookingAmount,
            appliesTo,
            hotels,
            rooms,
            userEligibility,
            totalUsageLimit,
            perUserUsageLimit,
            startDate,
            endDate,
            firstBookingOnly,
            isActive
        } = req.body;

        // Validate dates if provided
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            if (start >= end) {
                return res.status(400).json({ error: 'End date must be after start date' });
            }
            coupon.startDate = start;
            coupon.endDate = end;
        } else if (startDate) {
            coupon.startDate = new Date(startDate);
        } else if (endDate) {
            coupon.endDate = new Date(endDate);
        }

        // Update fields
        if (title) coupon.title = title;
        if (description !== undefined) coupon.description = description;
        if (discountType) coupon.discountType = discountType;
        if (discountValue) coupon.discountValue = discountValue;
        if (maxDiscountAmount !== undefined) coupon.maxDiscountAmount = maxDiscountAmount;
        if (minimumBookingAmount !== undefined) coupon.minimumBookingAmount = minimumBookingAmount;
        if (appliesTo) {
            coupon.appliesTo = appliesTo;
            if (appliesTo === 'SPECIFIC_HOTELS' && hotels) {
                coupon.hotels = hotels;
                coupon.rooms = [];
            } else if (appliesTo === 'SPECIFIC_ROOMS' && rooms) {
                coupon.rooms = rooms;
                coupon.hotels = [];
            } else {
                coupon.hotels = [];
                coupon.rooms = [];
            }
        }
        if (userEligibility) coupon.userEligibility = userEligibility;
        if (totalUsageLimit !== undefined) coupon.totalUsageLimit = totalUsageLimit;
        if (perUserUsageLimit) coupon.perUserUsageLimit = perUserUsageLimit;
        if (firstBookingOnly !== undefined) coupon.firstBookingOnly = firstBookingOnly;
        if (isActive !== undefined) coupon.isActive = isActive;

        await coupon.save();

        const updatedCoupon = await Coupon.findById(couponId)
            .populate('hotels', 'name slug')
            .populate('rooms', 'roomName roomNumber')
            .populate('createdBy', 'Name email');

        res.json({
            message: 'Coupon updated successfully',
            coupon: updatedCoupon
        });

    } catch (error) {
        console.error('Update coupon error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DELETE COUPON ====================
router.delete('/coupons/:couponId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can delete coupons
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { couponId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(couponId)) {
            return res.status(400).json({ error: 'Invalid coupon ID' });
        }

        const coupon = await Coupon.findById(couponId);

        if (!coupon) {
            return res.status(404).json({ error: 'Coupon not found' });
        }

        // Check if coupon has been used
        if (coupon.totalUsed > 0) {
            return res.status(400).json({ 
                error: 'Cannot delete coupon that has been used by users' 
            });
        }

        await Coupon.findByIdAndDelete(couponId);

        res.json({
            message: 'Coupon deleted successfully',
            coupon: {
                _id: coupon._id,
                code: coupon.code,
                title: coupon.title
            }
        });

    } catch (error) {
        console.error('Delete coupon error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== TOGGLE COUPON STATUS ====================
router.patch('/coupons/:couponId/toggle-status', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can toggle coupon status
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { couponId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(couponId)) {
            return res.status(400).json({ error: 'Invalid coupon ID' });
        }

        const coupon = await Coupon.findById(couponId);

        if (!coupon) {
            return res.status(404).json({ error: 'Coupon not found' });
        }

        coupon.isActive = !coupon.isActive;
        await coupon.save();

        res.json({
            message: `Coupon ${coupon.isActive ? 'activated' : 'deactivated'} successfully`,
            coupon: {
                _id: coupon._id,
                code: coupon.code,
                title: coupon.title,
                isActive: coupon.isActive
            }
        });

    } catch (error) {
        console.error('Toggle coupon status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET COUPON STATISTICS ====================
router.get('/coupons/statistics', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view statistics
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const now = new Date();

        const [
            totalCoupons,
            activeCoupons,
            inactiveCoupons,
            expiredCoupons,
            totalUsed,
            percentageCoupons,
            fixedCoupons,
            couponsByAppliesTo,
            topUsedCoupons,
            totalDiscountGiven,
            couponsExpiringSoon,
            newCouponsThisMonth
        ] = await Promise.all([
            Coupon.countDocuments(),
            Coupon.countDocuments({ isActive: true, endDate: { $gte: now } }),
            Coupon.countDocuments({ isActive: false }),
            Coupon.countDocuments({ endDate: { $lt: now }, isActive: true }),
            Coupon.aggregate([
                { $group: { _id: null, total: { $sum: '$totalUsed' } } }
            ]),
            Coupon.countDocuments({ discountType: 'PERCENTAGE' }),
            Coupon.countDocuments({ discountType: 'FIXED' }),
            Coupon.aggregate([
                { $group: { _id: '$appliesTo', count: { $sum: 1 } } }
            ]),
            Coupon.find({ totalUsed: { $gt: 0 } })
                .sort({ totalUsed: -1 })
                .limit(10)
                .select('code title totalUsed discountValue discountType'),
            Coupon.aggregate([
                {
                    $group: {
                        _id: null,
                        totalDiscount: { 
                            $sum: { 
                                $multiply: ['$totalUsed', '$discountValue'] 
                            } 
                        }
                    }
                }
            ]),
            Coupon.find({
                isActive: true,
                endDate: { $gte: now, $lte: moment(now).add(7, 'days').toDate() }
            })
                .select('code title endDate totalUsed')
                .sort({ endDate: 1 })
                .limit(10),
            Coupon.countDocuments({
                createdAt: { $gte: new Date(now.getFullYear(), now.getMonth(), 1) }
            })
        ]);

        const couponUtilizationRate = totalCoupons > 0 
            ? ((couponsWithUsage / totalCoupons) * 100).toFixed(1)
            : 0;

        const couponsWithUsage = await Coupon.countDocuments({ totalUsed: { $gt: 0 } });

        res.json({
            overview: {
                totalCoupons,
                activeCoupons,
                inactiveCoupons,
                expiredCoupons,
                couponUtilizationRate: parseFloat(couponUtilizationRate)
            },
            usage: {
                totalUsed: totalUsed[0]?.total || 0,
                couponsWithUsage,
                totalDiscountGiven: totalDiscountGiven[0]?.totalDiscount || 0
            },
            distribution: {
                byDiscountType: {
                    percentage: percentageCoupons,
                    fixed: fixedCoupons
                },
                byAppliesTo: couponsByAppliesTo
            },
            topPerforming: topUsedCoupons,
            expiringSoon: couponsExpiringSoon,
            growth: {
                newCouponsThisMonth
            },
            timestamp: now
        });

    } catch (error) {
        console.error('Get coupon statistics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== BULK CREATE COUPONS ====================
router.post('/coupons/bulk', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can bulk create coupons
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { coupons } = req.body;

        if (!coupons || !Array.isArray(coupons) || coupons.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of coupons' });
        }

        if (coupons.length > 50) {
            return res.status(400).json({ error: 'Maximum 50 coupons can be created at once' });
        }

        const createdCoupons = [];
        const errors = [];

        for (const couponData of coupons) {
            try {
                const {
                    title,
                    description,
                    discountType,
                    discountValue,
                    maxDiscountAmount,
                    minimumBookingAmount,
                    appliesTo,
                    hotels,
                    rooms,
                    userEligibility,
                    totalUsageLimit,
                    perUserUsageLimit,
                    startDate,
                    endDate,
                    firstBookingOnly
                } = couponData;

                // Basic validation
                if (!title || !discountType || !discountValue || !startDate || !endDate) {
                    errors.push({ 
                        coupon: title || 'Unknown', 
                        error: 'Missing required fields' 
                    });
                    continue;
                }

                const start = new Date(startDate);
                const end = new Date(endDate);

                if (start >= end) {
                    errors.push({ 
                        coupon: title, 
                        error: 'End date must be after start date' 
                    });
                    continue;
                }

                if (discountValue <= 0) {
                    errors.push({ 
                        coupon: title, 
                        error: 'Discount value must be greater than 0' 
                    });
                    continue;
                }

                if (discountType === 'PERCENTAGE' && discountValue > 100) {
                    errors.push({ 
                        coupon: title, 
                        error: 'Percentage discount cannot exceed 100%' 
                    });
                    continue;
                }

                // Generate code
                const code = generateCouponCode(title);
                let existingCoupon = await Coupon.findOne({ code });
                let counter = 1;
                while (existingCoupon) {
                    const newCode = `${code}${counter}`;
                    existingCoupon = await Coupon.findOne({ code: newCode });
                    if (!existingCoupon) {
                        break;
                    }
                    counter++;
                }
                const finalCode = existingCoupon ? `${code}${counter}` : code;

                const coupon = new Coupon({
                    code: finalCode,
                    title,
                    description: description || '',
                    discountType,
                    discountValue,
                    maxDiscountAmount: maxDiscountAmount || null,
                    minimumBookingAmount: minimumBookingAmount || 0,
                    appliesTo: appliesTo || 'ALL_HOTELS',
                    hotels: appliesTo === 'SPECIFIC_HOTELS' ? (hotels || []) : [],
                    rooms: appliesTo === 'SPECIFIC_ROOMS' ? (rooms || []) : [],
                    userEligibility: userEligibility || 'ALL_USERS',
                    totalUsageLimit: totalUsageLimit || null,
                    perUserUsageLimit: perUserUsageLimit || 1,
                    startDate: start,
                    endDate: end,
                    firstBookingOnly: firstBookingOnly || false,
                    createdBy: req.user._id,
                    isActive: true
                });

                await coupon.save();
                createdCoupons.push(coupon);

            } catch (error) {
                errors.push({ 
                    coupon: couponData.title || 'Unknown', 
                    error: error.message 
                });
            }
        }

        res.status(201).json({
            message: `Successfully created ${createdCoupons.length} coupons`,
            createdCoupons: createdCoupons.length > 0 ? createdCoupons : undefined,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        console.error('Bulk create coupons error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== BULK DELETE COUPONS ====================
router.delete('/coupons/bulk', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can bulk delete coupons
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { couponIds } = req.body;

        if (!couponIds || !Array.isArray(couponIds) || couponIds.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of coupon IDs' });
        }

        const validIds = couponIds.filter(id => mongoose.Types.ObjectId.isValid(id));

        // Check if any coupons have been used
        const couponsWithUsage = await Coupon.find({
            _id: { $in: validIds },
            totalUsed: { $gt: 0 }
        }).select('code title totalUsed');

        if (couponsWithUsage.length > 0) {
            return res.status(400).json({
                error: 'Some coupons have been used and cannot be deleted',
                couponsWithUsage: couponsWithUsage.map(c => ({
                    code: c.code,
                    title: c.title,
                    totalUsed: c.totalUsed
                }))
            });
        }

        const result = await Coupon.deleteMany({
            _id: { $in: validIds },
            totalUsed: 0
        });

        res.json({
            message: `Successfully deleted ${result.deletedCount} coupons`,
            deletedCount: result.deletedCount,
            failed: validIds.length - result.deletedCount
        });

    } catch (error) {
        console.error('Bulk delete coupons error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET COUPON USAGE DETAILS ====================
router.get('/coupons/:couponId/usage', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view usage details
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { couponId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(couponId)) {
            return res.status(400).json({ error: 'Invalid coupon ID' });
        }

        const coupon = await Coupon.findById(couponId)
            .populate('usedBy.user', 'Name email phone')
            .populate('usedBy.booking', 'bookingNumber checkInDate checkOutDate totalPrice');

        if (!coupon) {
            return res.status(404).json({ error: 'Coupon not found' });
        }

        const usageDetails = coupon.usedBy.map(usage => ({
            user: usage.user,
            booking: usage.booking,
            usedAt: usage.usedAt
        }));

        // Calculate total discount given
        const totalDiscount = coupon.totalUsed * coupon.discountValue;

        res.json({
            coupon: {
                code: coupon.code,
                title: coupon.title,
                discountType: coupon.discountType,
                discountValue: coupon.discountValue
            },
            usageStats: {
                totalUsed: coupon.totalUsed,
                totalDiscountGiven: totalDiscount,
                perUserLimit: coupon.perUserUsageLimit,
                totalUsageLimit: coupon.totalUsageLimit
            },
            usageDetails,
            count: usageDetails.length
        });

    } catch (error) {
        console.error('Get coupon usage details error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;