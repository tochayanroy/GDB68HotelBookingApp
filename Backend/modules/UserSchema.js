const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    Name: {
        type: String,
        required: true,
        trim: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
    phone: {
        type: String,
        unique: true,
        // sparse: true,
    },

    password: {
        type: String,
        required: true,
    },

    profileImage: {
        type: String,
        default: null,
    },

    dateOfBirth: {
        type: Date,
    },

    gender: {
        type: String,
        enum: ["MALE", "FEMALE", "OTHER"],
    },

    // Role Management
    role: {
        type: String,
        enum: ["SUPER_ADMIN", "ADMIN", "USER"],
        default: "USER",
    },

    // Account Status
    isActive: {
        type: Boolean,
        default: true,
    },

    isBlocked: {
        type: Boolean,
        default: false,
    },

    isVerified: {
        type: Boolean,
        default: false,
    },

    // Address
    address: {
        country: String,
        state: String,
        city: String,
        zipCode: String,
        addressLine: String,
    },

    // Hotel Owner Information
    businessInfo: {
        businessName: {
            type: String,
        },

        businessEmail: {
            type: String,
        },

        businessPhone: {
            type: String,
        },

        businessAddress: {
            type: String,
        },

        taxNumber: {
            type: String,
        },
    },

    // Hotel References
    hotels: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Hotel",
        },
    ],
},
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("User", userSchema);




























