const mongoose = require("mongoose");

const couponSchema = new mongoose.Schema(
    {
        // Coupon Information
        code: {
            type: String,
            required: true,
            unique: true,
            uppercase: true,
            trim: true,
            index: true,
        },

        title: {
            type: String,
            required: true,
            trim: true,
        },

        description: {
            type: String,
            trim: true,
        },

        // Discount Type
        discountType: {
            type: String,
            enum: ["PERCENTAGE", "FIXED"],
            required: true,
        },

        discountValue: {
            type: Number,
            required: true,
            min: 0,
        },

        // Maximum Discount (for percentage coupons)
        maxDiscountAmount: {
            type: Number,
            default: null,
        },

        // Minimum Booking Amount
        minimumBookingAmount: {
            type: Number,
            default: 0,
        },

        // Coupon Scope
        appliesTo: {
            type: String,
            enum: [
                "ALL_HOTELS",
                "SPECIFIC_HOTELS",
                "SPECIFIC_ROOMS",
            ],
            default: "ALL_HOTELS",
        },

        // Hotel Restriction
        hotels: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Hotel",
            },
        ],

        // Room Restriction
        rooms: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Room",
            },
        ],

        // User Restriction
        userEligibility: {
            type: String,
            enum: [
                "ALL_USERS",
                "NEW_USERS",
                "EXISTING_USERS",
            ],
            default: "ALL_USERS",
        },

        // Usage Limits
        totalUsageLimit: {
            type: Number,
            default: null, // unlimited
        },

        totalUsed: {
            type: Number,
            default: 0,
        },

        perUserUsageLimit: {
            type: Number,
            default: 1,
        },

        // Coupon Validity
        startDate: {
            type: Date,
            required: true,
        },

        endDate: {
            type: Date,
            required: true,
        },

        // Status
        isActive: {
            type: Boolean,
            default: true,
        },

        // First Booking Coupon
        firstBookingOnly: {
            type: Boolean,
            default: false,
        },

        // Track Users Who Used Coupon
        usedBy: [
            {
                user: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "User",
                },

                booking: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Booking",
                },

                usedAt: {
                    type: Date,
                    default: Date.now,
                },
            },
        ],

        // Created By Admin
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model( "Coupon", couponSchema);