const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
    {
        // Hotel Reference
        hotel: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Hotel",
            required: true,
        },

        // Basic Information
        roomName: {
            type: String,
            required: true,
            trim: true,
        },

        roomNumber: {
            type: String,
            required: true,
            trim: true,
        },

        description: {
            type: String,
            trim: true,
        },

        // Room Type
        roomType: {
            type: String,
            enum: [
                "SINGLE",
                "DOUBLE",
                "TWIN",
                "DELUXE",
                "SUPER_DELUXE",
                "SUITE",
                "EXECUTIVE_SUITE",
                "FAMILY",
                "PRESIDENTIAL_SUITE",
            ],
            required: true,
        },

        // Pricing
        pricePerNight: {
            type: Number,
            required: true,
            min: 0,
        },

        discountPrice: {
            type: Number,
            default: 0,
        },

        currency: {
            type: String,
            default: "INR",
        },

        // Capacity
        maxAdults: {
            type: Number,
            required: true,
            min: 1,
        },

        maxChildren: {
            type: Number,
            default: 0,
        },

        maxGuests: {
            type: Number,
            required: true,
        },

        // Room Size
        roomSize: {
            value: {
                type: Number,
            },

            unit: {
                type: String,
                enum: ["sqft", "sqm"],
                default: "sqft",
            },
        },

        // Bed Information
        beds: [
            {
                bedType: {
                    type: String,
                    enum: [
                        "SINGLE",
                        "DOUBLE",
                        "QUEEN",
                        "KING",
                        "SOFA_BED",
                    ],
                    required: true,
                },

                quantity: {
                    type: Number,
                    required: true,
                    min: 1,
                },
            },
        ],

        // Images
        thumbnail: {
            type: String,
            required: true,
        },

        images: [
            {
                type: String,
            },
        ],

        // Amenities
        amenities: [
            {
                type: String,
            },
        ],

        // Availability
        totalRooms: {
            type: Number,
            required: true,
            min: 1,
            default: 1,
        },

        availableRooms: {
            type: Number,
            required: true,
            min: 0,
            default: 1,
        },

        // Booking Statistics
        totalBookings: {
            type: Number,
            default: 0,
        },

        // Rating
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

        // Policies
        cancellationAllowed: {
            type: Boolean,
            default: true,
        },

        cancellationHours: {
            type: Number,
            default: 24,
        },

        refundable: {
            type: Boolean,
            default: true,
        },

        // Status
        status: {
            type: String,
            enum: [
                "AVAILABLE",
                "FULLY_BOOKED",
                "MAINTENANCE",
                "INACTIVE",
            ],
            default: "AVAILABLE",
        },

        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);


module.exports = mongoose.model("Room", roomSchema);