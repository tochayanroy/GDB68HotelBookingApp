const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
    {
        // Booking Number
        bookingNumber: {
            type: String,
            required: true,
            unique: true,
            index: true,
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

        // Rooms
        rooms: [
            {
                room: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Room",
                    required: true,
                },

                quantity: {
                    type: Number,
                    required: true,
                    min: 1,
                    default: 1,
                },

                adults: {
                    type: Number,
                    default: 1,
                },

                children: {
                    type: Number,
                    default: 0,
                },

                pricePerNight: {
                    type: Number,
                    required: true,
                },

                totalPrice: {
                    type: Number,
                    required: true,
                },
            },
        ],

        // Stay Information
        checkInDate: {
            type: Date,
            required: true,
        },

        checkOutDate: {
            type: Date,
            required: true,
        },

        totalNights: {
            type: Number,
            required: true,
        },

        // Guest Information
        guestDetails: [
            {
                fullName: {
                    type: String,
                    required: true,
                },

                age: Number,

                gender: {
                    type: String,
                    enum: ["MALE", "FEMALE", "OTHER"],
                },

                phone: String,

                email: String,
            },
        ],

        // Price Breakdown
        pricing: {
            roomAmount: {
                type: Number,
                required: true,
            },

            discountAmount: {
                type: Number,
                default: 0,
            },

            taxAmount: {
                type: Number,
                default: 0,
            },

            serviceCharge: {
                type: Number,
                default: 0,
            },

            finalAmount: {
                type: Number,
                required: true,
            },

            currency: {
                type: String,
                default: "INR",
            },
        },

        // Coupon
        coupon: {
            couponId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Coupon",
                default: null,
            },

            couponCode: {
                type: String,
                default: null,
            },

            discountAmount: {
                type: Number,
                default: 0,
            },
        },

        // Payment
        payment: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payment",
            default: null,
        },

        // Booking Status
        bookingStatus: {
            type: String,
            enum: [
                "PENDING",
                "CONFIRMED",
                "CHECKED_IN",
                "CHECKED_OUT",
                "COMPLETED",
                "CANCELLED",
                "NO_SHOW",
            ],
            default: "PENDING",
        },

        // Cancellation
        cancellation: {
            isCancelled: {
                type: Boolean,
                default: false,
            },

            cancelledAt: {
                type: Date,
                default: null,
            },

            cancelledBy: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                default: null,
            },

            cancellationReason: {
                type: String,
                default: null,
            },
        },

        // Refund
        refund: {
            isRefundRequested: {
                type: Boolean,
                default: false,
            },

            refundAmount: {
                type: Number,
                default: 0,
            },

            refundStatus: {
                type: String,
                enum: [
                    "NONE",
                    "PENDING",
                    "APPROVED",
                    "REJECTED",
                    "COMPLETED",
                ],
                default: "NONE",
            },
        },

        // Check-In / Check-Out
        checkedInAt: {
            type: Date,
            default: null,
        },

        checkedOutAt: {
            type: Date,
            default: null,
        },

        // Special Request
        specialRequest: {
            type: String,
            trim: true,
        },

        // Booking Source
        bookingSource: {
            type: String,
            enum: [
                "WEB",
                "ANDROID",
                "IOS",
                "ADMIN_PANEL",
            ],
            default: "WEB",
        },
        
        // Active Flag
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);


module.exports = mongoose.model("Booking", bookingSchema);