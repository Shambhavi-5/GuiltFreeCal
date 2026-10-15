const mongoose = require('mongoose');

const replanHistorySchema = new mongoose.Schema({
  date: { type: String, required: true },
  replanAt: { type: Date, default: Date.now },
  energyAtReplan: { type: Number, min: 1, max: 5 },
  energyLabel: { type: String },
  diagnosis: { type: String },
  adjustments: [{ type: String }],
  totalWorkMinutes: { type: Number },
  totalRestMinutes: { type: Number },
  skippedCount: { type: Number },
  snapshotBefore: [{ type: mongoose.Schema.Types.Mixed }],
  snapshotAfter: [{ type: mongoose.Schema.Types.Mixed }]
}, { timestamps: true });

module.exports = mongoose.model('ReplanHistory', replanHistorySchema);
