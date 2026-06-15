const mongoose = require("mongoose");

const hotelSchema = new mongoose.Schema(
    {
        // Hotel Basic Information
        name: {
            type: String,
            required: true,
            trim: true,
        },

        slug: {
            type: String,
            unique: true,
            lowercase: true,
            trim: true,
        },

        description: {
            type: String,
            required: true,
        },

        // Hotel Owner
        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        // Hotel Images
        thumbnail: {
            type: String,
            required: true,
        },

        images: [
            {
                type: String,
            },
        ],

        // Contact Information
        contact: {
            phone: {
                type: String,
                required: true,
            },

            email: {
                type: String,
                required: true,
            },

            website: {
                type: String,
            },
        },

        // Address
        address: {
            country: {
                type: String,
                required: true,
            },

            state: {
                type: String,
                required: true,
            },

            city: {
                type: String,
                required: true,
            },

            zipCode: {
                type: String,
            },

            addressLine: {
                type: String,
                required: true,
            },
        },

        // Geo Location
        location: {
            type: {
                type: String,
                enum: ["Point"],
                default: "Point",
            },

            coordinates: {
                type: [Number], // [longitude, latitude]
                default: [0, 0],
            },
        },

        // Hotel Star Category
        starRating: {
            type: Number,
            min: 1,
            max: 5,
            default: 3,
        },

        // Amenities
        amenities: [
            {
                type: String,
            },
        ],

        // Hotel Policies
        policies: {
            checkInTime: {
                type: String,
                default: "14:00",
            },

            checkOutTime: {
                type: String,
                default: "12:00",
            },

            cancellationPolicy: {
                type: String,
            },

            childPolicy: {
                type: String,
            },

            petPolicy: {
                type: String,
            },

            smokingPolicy: {
                type: String,
            },
        },

        // Room References
        rooms: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Room",
            },
        ],

        // Ratings
        averageRating: {
            type: Number,
            default: 0,
            min: 0,
            max: 5,
        },

        totalReviews: {
            type: Number,
            default: 0,
        },

        // Review References
        reviews: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Review",
            },
        ],

        // Booking Statistics
        totalBookings: {
            type: Number,
            default: 0,
        },

        // Verification
        isVerified: {
            type: Boolean,
            default: false,
        },

        // Status
        status: {
            type: String,
            enum: [
                "PENDING",
                "APPROVED",
                "REJECTED",
                "SUSPENDED",
            ],
            default: "PENDING",
        },

        // Visibility
        isActive: {
            type: Boolean,
            default: true,
        },

        // Featured Hotel
        isFeatured: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("Hotel", hotelSchema);