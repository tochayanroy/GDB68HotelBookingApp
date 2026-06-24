const express = require('express');
const router = express.Router();
const passport = require('passport');
const mongoose = require('mongoose');

const Notification = require('../models/NotificationSchema.js');
const User = require('../models/UserSchema.js');
const Booking = require('../models/BookingSchema.js');
const Hotel = require('../models/HotelSchema.js');

// ==================== HELPER FUNCTIONS ====================

// Create notification
async function createNotification(data) {
    try {
        const notification = new Notification({
            recipient: data.recipient,
            sender: data.sender || null,
            title: data.title,
            message: data.message,
            type: data.type,
            actionUrl: data.actionUrl || null,
            booking: data.booking || null,
            hotel: data.hotel || null,
            room: data.room || null,
            payment: data.payment || null,
            review: data.review || null,
            channels: data.channels || { inApp: true, push: false, email: false, sms: false },
            priority: data.priority || 'MEDIUM',
            deliveryStatus: 'PENDING'
        });

        await notification.save();

        // In production, trigger push notification, email, SMS here
        // based on channels configuration

        return notification;
    } catch (error) {
        console.error('Create notification error:', error);
        throw error;
    }
}

// Mark notification as delivered
async function markAsDelivered(notificationId) {
    const notification = await Notification.findById(notificationId);
    if (notification) {
        notification.deliveryStatus = 'DELIVERED';
        notification.deliveredAt = new Date();
        await notification.save();
    }
    return notification;
}

// ==================== GET MY NOTIFICATIONS ====================
router.get('/my-notifications', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            type,
            isRead,
            priority,
            startDate,
            endDate,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const query = {
            recipient: req.user._id,
            isDeleted: false
        };

        if (type && type !== 'all') {
            query.type = type;
        }

        if (isRead !== undefined) {
            query.isRead = isRead === 'true';
        }

        if (priority && priority !== 'all') {
            query.priority = priority;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [notifications, totalCount] = await Promise.all([
            Notification.find(query)
                .populate('sender', 'Name email profileImage')
                .populate('booking', 'bookingNumber bookingStatus')
                .populate('hotel', 'name slug')
                .populate('room', 'roomName roomNumber')
                .populate('payment', 'amount paymentStatus')
                .populate('review', 'rating')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Notification.countDocuments(query)
        ]);

        // Get unread count
        const unreadCount = await Notification.countDocuments({
            recipient: req.user._id,
            isRead: false,
            isDeleted: false
        });

        res.json({
            notifications,
            unreadCount,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalNotifications: totalCount,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get my notifications error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== MARK NOTIFICATION AS READ ====================
router.patch('/notifications/:notificationId/read', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { notificationId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(notificationId)) {
            return res.status(400).json({ error: 'Invalid notification ID' });
        }

        const notification = await Notification.findOne({
            _id: notificationId,
            recipient: req.user._id,
            isDeleted: false
        });

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        notification.isRead = true;
        await notification.save();

        res.json({
            message: 'Notification marked as read',
            notification: {
                _id: notification._id,
                isRead: notification.isRead
            }
        });

    } catch (error) {
        console.error('Mark notification as read error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== MARK ALL NOTIFICATIONS AS READ ====================
router.patch('/notifications/mark-all-read', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const result = await Notification.updateMany(
            {
                recipient: req.user._id,
                isRead: false,
                isDeleted: false
            },
            { $set: { isRead: true } }
        );

        res.json({
            message: `${result.modifiedCount} notifications marked as read`,
            modifiedCount: result.modifiedCount
        });

    } catch (error) {
        console.error('Mark all notifications as read error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET UNREAD COUNT ====================
router.get('/notifications/unread-count', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const count = await Notification.countDocuments({
            recipient: req.user._id,
            isRead: false,
            isDeleted: false
        });

        res.json({ unreadCount: count });

    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DELETE NOTIFICATION ====================
router.delete('/notifications/:notificationId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { notificationId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(notificationId)) {
            return res.status(400).json({ error: 'Invalid notification ID' });
        }

        const notification = await Notification.findOne({
            _id: notificationId,
            recipient: req.user._id
        });

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        // Soft delete
        notification.isDeleted = true;
        notification.deletedAt = new Date();
        await notification.save();

        res.json({
            message: 'Notification deleted successfully'
        });

    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DELETE ALL NOTIFICATIONS ====================
router.delete('/notifications/delete-all', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const result = await Notification.updateMany(
            {
                recipient: req.user._id,
                isDeleted: false
            },
            {
                $set: {
                    isDeleted: true,
                    deletedAt: new Date()
                }
            }
        );

        res.json({
            message: `${result.modifiedCount} notifications deleted`,
            modifiedCount: result.modifiedCount
        });

    } catch (error) {
        console.error('Delete all notifications error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: SEND NOTIFICATION ====================
router.post('/admin/notifications/send', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            recipients,
            title,
            message,
            type,
            actionUrl,
            priority = 'MEDIUM',
            channels,
            bookingId,
            hotelId,
            roomId,
            paymentId,
            reviewId
        } = req.body;

        // Validate recipients
        if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ error: 'Please provide at least one recipient' });
        }

        if (recipients.length > 100) {
            return res.status(400).json({ error: 'Cannot send to more than 100 recipients at once' });
        }

        // Validate required fields
        if (!title || !message || !type) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate recipients exist
        const users = await User.find({
            _id: { $in: recipients },
            isActive: true
        }).select('_id');

        if (users.length === 0) {
            return res.status(404).json({ error: 'No valid recipients found' });
        }

        // Create notifications for each recipient
        const notifications = [];
        for (const user of users) {
            const notification = await createNotification({
                recipient: user._id,
                sender: req.user._id,
                title,
                message,
                type,
                actionUrl: actionUrl || null,
                booking: bookingId || null,
                hotel: hotelId || null,
                room: roomId || null,
                payment: paymentId || null,
                review: reviewId || null,
                channels: channels || { inApp: true, push: false, email: false, sms: false },
                priority: priority
            });
            notifications.push(notification);
        }

        // Process delivery for each channel
        // In production, integrate with push notification service, email service, SMS service

        res.status(201).json({
            message: `Notification sent to ${notifications.length} recipients`,
            recipients: notifications.length,
            notifications: notifications.map(n => ({
                _id: n._id,
                recipient: n.recipient,
                title: n.title,
                deliveryStatus: n.deliveryStatus
            }))
        });

    } catch (error) {
        console.error('Send notification error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: SEND BULK NOTIFICATIONS ====================
router.post('/admin/notifications/bulk-send', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            userType,
            title,
            message,
            type,
            actionUrl,
            priority = 'MEDIUM',
            channels,
            hotelId
        } = req.body;

        if (!userType || !title || !message || !type) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Build recipient query
        const query = { isActive: true };

        if (userType === 'ALL_USERS') {
            // All active users
        } else if (userType === 'HOTEL_OWNERS') {
            query.hotels = { $exists: true, $ne: [] };
        } else if (userType === 'GUESTS') {
            query.hotels = { $exists: false };
        } else if (userType === 'ADMINS') {
            query.role = { $in: ['SUPER_ADMIN', 'ADMIN'] };
        } else if (userType === 'SPECIFIC_HOTEL_GUESTS' && hotelId) {
            // Get users who have booked this hotel
            const bookings = await Booking.find({
                hotel: hotelId,
                bookingStatus: 'COMPLETED'
            }).distinct('user');
            query._id = { $in: bookings };
        } else if (userType === 'SPECIFIC_HOTEL_OWNERS' && hotelId) {
            const hotel = await Hotel.findById(hotelId);
            if (hotel) {
                query._id = hotel.owner;
            }
        } else {
            return res.status(400).json({ error: 'Invalid user type or missing parameters' });
        }

        // Get recipients
        const users = await User.find(query).select('_id');

        if (users.length === 0) {
            return res.status(404).json({ error: 'No recipients found' });
        }

        if (users.length > 1000) {
            return res.status(400).json({ error: 'Too many recipients. Please use specific filters.' });
        }

        // Create notifications
        const notifications = [];
        for (const user of users) {
            const notification = await createNotification({
                recipient: user._id,
                sender: req.user._id,
                title,
                message,
                type,
                actionUrl: actionUrl || null,
                channels: channels || { inApp: true, push: false, email: false, sms: false },
                priority: priority
            });
            notifications.push(notification);
        }

        res.status(201).json({
            message: `Notification sent to ${notifications.length} recipients`,
            recipients: notifications.length,
            userType,
            notificationCount: notifications.length
        });

    } catch (error) {
        console.error('Bulk send notification error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: GET ALL NOTIFICATIONS ====================
router.get('/admin/notifications', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            page = 1,
            limit = 20,
            search,
            recipient,
            type,
            isRead,
            isDeleted,
            priority,
            startDate,
            endDate,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const query = {};

        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { message: { $regex: search, $options: 'i' } }
            ];
        }

        if (recipient && mongoose.Types.ObjectId.isValid(recipient)) {
            query.recipient = recipient;
        }

        if (type && type !== 'all') {
            query.type = type;
        }

        if (isRead !== undefined) {
            query.isRead = isRead === 'true';
        }

        if (isDeleted !== undefined) {
            query.isDeleted = isDeleted === 'true';
        }

        if (priority && priority !== 'all') {
            query.priority = priority;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [notifications, totalCount] = await Promise.all([
            Notification.find(query)
                .populate('recipient', 'Name email profileImage')
                .populate('sender', 'Name email')
                .populate('booking', 'bookingNumber bookingStatus')
                .populate('hotel', 'name slug')
                .populate('room', 'roomName roomNumber')
                .populate('payment', 'amount paymentStatus')
                .populate('review', 'rating')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Notification.countDocuments(query)
        ]);

        // Get statistics
        const stats = await Notification.aggregate([
            { $match: query },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    unread: {
                        $sum: { $cond: [{ $eq: ['$isRead', false] }, 1, 0] }
                    },
                    read: {
                        $sum: { $cond: [{ $eq: ['$isRead', true] }, 1, 0] }
                    },
                    byType: { $push: '$type' }
                }
            }
        ]);

        // Get type distribution
        const typeDistribution = await Notification.aggregate([
            { $match: query },
            { $group: { _id: '$type', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        res.json({
            notifications,
            statistics: stats[0] || {
                total: 0,
                unread: 0,
                read: 0
            },
            typeDistribution,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalNotifications: totalCount,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get all notifications admin error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: GET NOTIFICATION DETAILS ====================
router.get('/admin/notifications/:notificationId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { notificationId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(notificationId)) {
            return res.status(400).json({ error: 'Invalid notification ID' });
        }

        const notification = await Notification.findById(notificationId)
            .populate('recipient', 'Name email phone profileImage')
            .populate('sender', 'Name email')
            .populate('booking', 'bookingNumber bookingStatus checkInDate checkOutDate')
            .populate('hotel', 'name slug address')
            .populate('room', 'roomName roomNumber roomType')
            .populate('payment', 'amount paymentStatus gateway')
            .populate('review', 'rating comment');

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        res.json(notification);

    } catch (error) {
        console.error('Get notification details error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: UPDATE NOTIFICATION ====================
router.put('/admin/notifications/:notificationId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { notificationId } = req.params;
        const {
            title,
            message,
            type,
            priority,
            isRead,
            isDeleted
        } = req.body;

        if (!mongoose.Types.ObjectId.isValid(notificationId)) {
            return res.status(400).json({ error: 'Invalid notification ID' });
        }

        const notification = await Notification.findById(notificationId);

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        // Update fields
        if (title) notification.title = title;
        if (message) notification.message = message;
        if (type) notification.type = type;
        if (priority) notification.priority = priority;
        if (isRead !== undefined) notification.isRead = isRead;
        if (isDeleted !== undefined) {
            notification.isDeleted = isDeleted;
            if (isDeleted) {
                notification.deletedAt = new Date();
            } else {
                notification.deletedAt = null;
            }
        }

        await notification.save();

        const updatedNotification = await Notification.findById(notificationId)
            .populate('recipient', 'Name email')
            .populate('sender', 'Name email');

        res.json({
            message: 'Notification updated successfully',
            notification: updatedNotification
        });

    } catch (error) {
        console.error('Update notification error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: DELETE NOTIFICATION ====================
router.delete('/admin/notifications/:notificationId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { notificationId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(notificationId)) {
            return res.status(400).json({ error: 'Invalid notification ID' });
        }

        const notification = await Notification.findById(notificationId);

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        await Notification.findByIdAndDelete(notificationId);

        res.json({
            message: 'Notification permanently deleted',
            deletedNotification: {
                _id: notification._id,
                title: notification.title,
                recipient: notification.recipient
            }
        });

    } catch (error) {
        console.error('Delete notification admin error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: GET NOTIFICATION STATISTICS ====================
router.get('/admin/notifications/statistics', passport.authenticate('jwt', { session: false }), async (req, res) => {
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
            totalNotifications,
            unreadNotifications,
            readNotifications,
            deletedNotifications,
            sentToday,
            sentThisWeek,
            sentThisMonth,
            sentThisYear,
            byType,
            byPriority,
            byChannel,
            deliveryStats,
            topRecipients
        ] = await Promise.all([
            Notification.countDocuments(),
            Notification.countDocuments({ isRead: false, isDeleted: false }),
            Notification.countDocuments({ isRead: true, isDeleted: false }),
            Notification.countDocuments({ isDeleted: true }),
            Notification.countDocuments({ createdAt: { $gte: startOfDay } }),
            Notification.countDocuments({ createdAt: { $gte: startOfWeek } }),
            Notification.countDocuments({ createdAt: { $gte: startOfMonth } }),
            Notification.countDocuments({ createdAt: { $gte: startOfYear } }),
            Notification.aggregate([
                { $group: { _id: '$type', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]),
            Notification.aggregate([
                { $group: { _id: '$priority', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]),
            Notification.aggregate([
                {
                    $group: {
                        _id: null,
                        inApp: { $sum: { $cond: ['$channels.inApp', 1, 0] } },
                        push: { $sum: { $cond: ['$channels.push', 1, 0] } },
                        email: { $sum: { $cond: ['$channels.email', 1, 0] } },
                        sms: { $sum: { $cond: ['$channels.sms', 1, 0] } }
                    }
                }
            ]),
            Notification.aggregate([
                {
                    $group: {
                        _id: '$deliveryStatus',
                        count: { $sum: 1 }
                    }
                }
            ]),
            Notification.aggregate([
                {
                    $match: { isDeleted: false }
                },
                {
                    $group: {
                        _id: '$recipient',
                        count: { $sum: 1 }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 10 },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                { $unwind: '$user' }
            ])
        ]);

        const readRate = totalNotifications > 0 
            ? ((readNotifications / totalNotifications) * 100).toFixed(1)
            : 0;

        const channelStats = byChannel[0] || { inApp: 0, push: 0, email: 0, sms: 0 };

        res.json({
            overview: {
                totalNotifications,
                unreadNotifications,
                readNotifications,
                deletedNotifications,
                readRate: parseFloat(readRate)
            },
            growth: {
                today: sentToday,
                thisWeek: sentThisWeek,
                thisMonth: sentThisMonth,
                thisYear: sentThisYear
            },
            distribution: {
                byType,
                byPriority,
                deliveryStats
            },
            channels: {
                inApp: channelStats.inApp,
                push: channelStats.push,
                email: channelStats.email,
                sms: channelStats.sms
            },
            topRecipients: topRecipients.map(item => ({
                userId: item._id,
                userName: item.user.Name,
                notificationCount: item.count
            })),
            timestamp: now
        });

    } catch (error) {
        console.error('Get notification statistics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== CREATE BOOKING NOTIFICATION ====================
// This endpoint is used internally or by webhooks
router.post('/notifications/booking', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { bookingId, event } = req.body;

        if (!bookingId || !event) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const booking = await Booking.findById(bookingId)
            .populate('user', 'Name email')
            .populate('hotel', 'name');

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        let title, message, type;

        switch (event) {
            case 'CONFIRMED':
                title = 'Booking Confirmed';
                message = `Your booking at ${booking.hotel.name} has been confirmed. Booking #${booking.bookingNumber}`;
                type = 'BOOKING_CONFIRMED';
                break;
            case 'CANCELLED':
                title = 'Booking Cancelled';
                message = `Your booking at ${booking.hotel.name} has been cancelled. Booking #${booking.bookingNumber}`;
                type = 'BOOKING_CANCELLED';
                break;
            case 'COMPLETED':
                title = 'Booking Completed';
                message = `Your stay at ${booking.hotel.name} has been completed. Thank you for choosing us!`;
                type = 'BOOKING_COMPLETED';
                break;
            case 'CHECK_IN_REMINDER':
                title = 'Check-in Reminder';
                message = `Reminder: Your check-in at ${booking.hotel.name} is tomorrow. Booking #${booking.bookingNumber}`;
                type = 'CHECK_IN_REMINDER';
                break;
            case 'CHECK_OUT_REMINDER':
                title = 'Check-out Reminder';
                message = `Reminder: Your check-out from ${booking.hotel.name} is tomorrow. Booking #${booking.bookingNumber}`;
                type = 'CHECK_OUT_REMINDER';
                break;
            default:
                return res.status(400).json({ error: 'Invalid event type' });
        }

        const notification = await createNotification({
            recipient: booking.user._id,
            title,
            message,
            type,
            booking: bookingId,
            hotel: booking.hotel._id,
            actionUrl: `/bookings/${bookingId}`,
            priority: 'HIGH'
        });

        res.status(201).json({
            message: 'Booking notification created successfully',
            notification
        });

    } catch (error) {
        console.error('Create booking notification error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== CREATE PAYMENT NOTIFICATION ====================
router.post('/notifications/payment', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { paymentId, event } = req.body;

        if (!paymentId || !event) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const payment = await Payment.findById(paymentId)
            .populate('user', 'Name email')
            .populate('hotel', 'name');

        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        let title, message, type;

        switch (event) {
            case 'SUCCESS':
                title = 'Payment Successful';
                message = `Your payment of ${payment.currency} ${payment.amount} for booking at ${payment.hotel.name} was successful.`;
                type = 'PAYMENT_SUCCESS';
                break;
            case 'FAILED':
                title = 'Payment Failed';
                message = `Your payment of ${payment.currency} ${payment.amount} for booking at ${payment.hotel.name} failed. Please try again.`;
                type = 'PAYMENT_FAILED';
                break;
            case 'REFUNDED':
                title = 'Payment Refunded';
                message = `Your payment of ${payment.currency} ${payment.amount} for booking at ${payment.hotel.name} has been refunded.`;
                type = 'REFUND_PROCESSED';
                break;
            default:
                return res.status(400).json({ error: 'Invalid event type' });
        }

        const notification = await createNotification({
            recipient: payment.user._id,
            title,
            message,
            type,
            payment: paymentId,
            hotel: payment.hotel._id,
            actionUrl: `/payments/${paymentId}`,
            priority: 'HIGH'
        });

        res.status(201).json({
            message: 'Payment notification created successfully',
            notification
        });

    } catch (error) {
        console.error('Create payment notification error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== CREATE SYSTEM NOTIFICATION ====================
router.post('/notifications/system', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { userId, title, message, actionUrl, priority = 'MEDIUM' } = req.body;

        if (!userId || !title || !message) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const notification = await createNotification({
            recipient: userId,
            sender: req.user._id,
            title,
            message,
            type: 'SYSTEM_NOTIFICATION',
            actionUrl: actionUrl || null,
            priority: priority
        });

        res.status(201).json({
            message: 'System notification created successfully',
            notification
        });

    } catch (error) {
        console.error('Create system notification error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN: RESEND NOTIFICATION ====================
router.post('/admin/notifications/:notificationId/resend', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { notificationId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(notificationId)) {
            return res.status(400).json({ error: 'Invalid notification ID' });
        }

        const notification = await Notification.findById(notificationId);

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        // Reset delivery status
        notification.deliveryStatus = 'PENDING';
        notification.sentAt = null;
        notification.deliveredAt = null;
        notification.failureReason = null;
        await notification.save();

        // In production, resend notification through channels
        // ...

        res.json({
            message: 'Notification resend initiated',
            notification: {
                _id: notification._id,
                deliveryStatus: notification.deliveryStatus
            }
        });

    } catch (error) {
        console.error('Resend notification error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;