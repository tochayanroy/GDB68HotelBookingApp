const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
    {
        // Related Booking
        booking: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Booking",
            required: true,
        },

        // Customer
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        // Hotel
        hotel: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Hotel",
            required: true,
        },

        // Payment Amount
        amount: {
            type: Number,
            required: true,
            min: 0,
        },

        currency: {
            type: String,
            default: "INR",
            uppercase: true,
        },

        // Payment Method
        paymentMethod: {
            type: String,
            enum: [
                "CARD",
                "UPI",
                "NET_BANKING",
                "WALLET",
                "PAYPAL",
                "RAZORPAY",
                "STRIPE",
                "CASH",
            ],
            required: true,
        },

        // Payment Gateway
        gateway: {
            type: String,
            enum: [
                "RAZORPAY",
                "STRIPE",
                "PAYPAL",
                "SSL_COMMERZ",
                "MANUAL",
            ],
            required: true,
        },

        // Internal Transaction ID
        transactionId: {
            type: String,
            required: true,
            unique: true,
        },

        // Gateway Transaction ID
        gatewayTransactionId: {
            type: String,
            default: null,
        },

        // Gateway Order ID
        gatewayOrderId: {
            type: String,
            default: null,
        },

        // Gateway Payment ID
        gatewayPaymentId: {
            type: String,
            default: null,
        },

        // Payment Status
        paymentStatus: {
            type: String,
            enum: [
                "PENDING",
                "PROCESSING",
                "PAID",
                "FAILED",
                "CANCELLED",
                "REFUNDED",
                "PARTIALLY_REFUNDED",
            ],
            default: "PENDING",
        },

        // Refund Information
        refund: {
            isRefunded: {
                type: Boolean,
                default: false,
            },

            refundAmount: {
                type: Number,
                default: 0,
            },

            refundReason: {
                type: String,
                default: null,
            },

            refundTransactionId: {
                type: String,
                default: null,
            },

            refundedAt: {
                type: Date,
                default: null,
            },
        },

        // Failure Information
        failureReason: {
            type: String,
            default: null,
        },

        // Gateway Raw Response
        gatewayResponse: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },

        // Payment Dates
        paidAt: {
            type: Date,
            default: null,
        },

        // Security / Verification
        isVerified: {
            type: Boolean,
            default: false,
        },

        verifiedAt: {
            type: Date,
            default: null,
        },

        // Notes
        notes: {
            type: String,
            trim: true,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("Payment", paymentSchema);