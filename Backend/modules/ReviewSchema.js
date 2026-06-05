const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
    {
        // Reviewer
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        // Related Hotel
        hotel: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Hotel",
            required: true,
        },

        // Optional Room Review
        room: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Room",
            default: null,
        },

        // Related Booking
        booking: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Booking",
            required: true,
        },

        // Rating
        rating: {
            type: Number,
            required: true,
            min: 1,
            max: 5,
        },

        // Review Title
        title: {
            type: String,
            trim: true,
            maxlength: 150,
        },

        // Review Description
        comment: {
            type: String,
            required: true,
            trim: true,
            maxlength: 3000,
        },

        // Booking Verification
        isVerifiedStay: {
            type: Boolean,
            default: true,
        },

        // Helpful Votes
        helpfulCount: {
            type: Number,
            default: 0,
        },

        // Users who marked helpful
        helpfulBy: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
            },
        ],

        // Admin Reply
        adminReply: {
            message: {
                type: String,
                trim: true,
            },

            repliedBy: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
            },

            repliedAt: {
                type: Date,
            },
        },

        // Moderation
        status: {
            type: String,
            enum: [
                "PENDING",
                "APPROVED",
                "REJECTED",
                "HIDDEN",
            ],
            default: "PENDING",
        },

        isEdited: {
            type: Boolean,
            default: false,
        },

    },
    {
        timestamps: true,
    }
);


module.exports = mongoose.model("Review", reviewSchema);