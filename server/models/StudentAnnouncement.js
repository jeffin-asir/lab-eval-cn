import mongoose from 'mongoose';

// One delivery per student makes acknowledgement/dismissal independent for
// broadcasts, batches, and manually selected groups.
const studentAnnouncementSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  message: { type: String, required: true, maxlength: 2000 },
  type: { type: String, enum: ['notification', 'alert'], required: true },
  sentBy: { type: String, required: true },
  dismissedAt: { type: Date, default: null },
}, { timestamps: true });

studentAnnouncementSchema.index({ userId: 1, dismissedAt: 1, createdAt: -1 });

export default mongoose.model('StudentAnnouncement', studentAnnouncementSchema);
