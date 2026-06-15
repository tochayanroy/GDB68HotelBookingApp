const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
    {
        // Receiver
        recipient: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        // Sender (Optional)
        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        // Notification Title
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 150,
        },

        // Notification Message
        message: {
            type: String,
            required: true,
            trim: true,
            maxlength: 1000,
        },

        // Notification Category
        type: {
            type: String,
            enum: [
                "BOOKING_CREATED",
                "BOOKING_CONFIRMED",
                "BOOKING_CANCELLED",
                "BOOKING_COMPLETED",

                "PAYMENT_SUCCESS",
                "PAYMENT_FAILED",
                "REFUND_PROCESSED",

                "CHECK_IN_REMINDER",
                "CHECK_OUT_REMINDER",

                "REVIEW_REMINDER",

                "HOTEL_APPROVED",
                "HOTEL_REJECTED",

                "ACCOUNT_VERIFIED",
                "ACCOUNT_BLOCKED",

                "SYSTEM_NOTIFICATION",

                "ADMIN_NOTIFICATION",
            ],
            required: true,
        },

        // Deep Linking
        actionUrl: {
            type: String,
            default: null,
        },

        // Related Entities
        booking: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Booking",
            default: null,
        },

        hotel: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Hotel",
            default: null,
        },

        room: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Room",
            default: null,
        },

        payment: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payment",
            default: null,
        },

        review: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Review",
            default: null,
        },

        // Read Status
        isRead: {
            type: Boolean,
            default: false,
        },

        // Delivery Channels
        channels: {
            inApp: {
                type: Boolean,
                default: true,
            },

            push: {
                type: Boolean,
                default: false,
            },

            email: {
                type: Boolean,
                default: false,
            },

            sms: {
                type: Boolean,
                default: false,
            },
        },

        // Delivery Status
        deliveryStatus: {
            type: String,
            enum: [
                "PENDING",
                "SENT",
                "DELIVERED",
                "FAILED",
            ],
            default: "PENDING",
        },

        sentAt: {
            type: Date,
            default: null,
        },

        deliveredAt: {
            type: Date,
            default: null,
        },

        failureReason: {
            type: String,
            default: null,
        },

        // Priority
        priority: {
            type: String,
            enum: [
                "LOW",
                "MEDIUM",
                "HIGH",
                "URGENT",
            ],
            default: "MEDIUM",
        },

        // Soft Delete
        isDeleted: {
            type: Boolean,
            default: false,
        },

        deletedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("Notification", notificationSchema);