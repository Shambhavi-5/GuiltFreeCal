
const mongoose = require("mongoose");

const activitySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    category: {
      type: String,
      required: true,
      enum: ["Study", "Break", "Project", "Personal"],
    },

    start: {
      type: String,
      required: true,
    },

    end: {
      type: String,
      required: true,
    },

    duration: {
      type: String,
      required: true,
    },

    type: {
      type: String,
      enum: ["fixed", "flexible"],
      default: "flexible",
    },

    status: {
      type: String,
      enum: ["upcoming", "in-progress", "done", "partial", "skipped", "missed"],
      default: "upcoming",
    },

    // Expected energy requirement of the task (LOW, MEDIUM, HIGH)
    expectedEnergy: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH"],
      default: "MEDIUM",
    },

    // Task priority on a simple 1-5 scale (1 = lowest, 5 = highest)
    priority: {
      type: Number,
      min: 1,
      max: 5,
      default: 3,
    },

    // Optional deadline or preferred completion time (e.g. "17:00")
    deadline: {
      type: String,
      default: null,
    },

    // Actual duration in minutes recorded upon completion
    actualDuration: {
      type: Number,
      default: null,
    },

    // Actual perceived energy level recorded upon completion
    actualEnergy: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", null],
      default: null,
    },

    // Optional short reflection after completing the activity
    reflection: {
      type: String,
      default: "",
    },

    // Legacy energy field preserved for backward compatibility
    energy: {
      type: Number,
      min: 1,
      max: 5,
      default: 3,
    },

    date: {
      type: String,
      required: true,
    },

    userId: {
      type: String,
      default: "default-user",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Activity", activitySchema);
