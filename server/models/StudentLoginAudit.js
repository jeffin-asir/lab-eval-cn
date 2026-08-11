import mongoose from 'mongoose';

// Unlike StudentConnection, these records intentionally do not expire. They
// are the teacher's investigation trail for a live lab assignment: a student
// can log out, but that must not erase the device/account relationship.
const studentLoginAuditSchema = new mongoose.Schema({
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'LabAssignment', required: true, index: true },
  moduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Module', required: true },
  slotKey: { type: String, default: '' },
  userId: { type: String, required: true, index: true },
  studentName: { type: String, default: '' },
  batch: { type: String, default: '' },
  connectionId: { type: String, required: true },
  // Device ID comes from a browser-local random ID. If a browser cannot send
  // one, deviceKey falls back to network + user-agent and is labelled as such.
  deviceId: { type: String, default: '' },
  deviceKey: { type: String, required: true, index: true },
  deviceSource: { type: String, enum: ['browser', 'network-fallback'], required: true },
  ipAddress: { type: String, required: true },
  userAgent: { type: String, default: '' },
  loggedInAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true });

studentLoginAuditSchema.index({ assignmentId: 1, userId: 1, deviceKey: 1 });
studentLoginAuditSchema.index({ assignmentId: 1, deviceKey: 1, userId: 1 });

export default mongoose.model('StudentLoginAudit', studentLoginAuditSchema);
