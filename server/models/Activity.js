
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
      enum: ["upcoming", "done", "partial", "skipped"],
      default: "upcoming",
    },

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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Activity", activitySchema);
