import mongoose from 'mongoose';

// Singleton document holding whichever module is currently "live" for
// students. Kept separate from the per-student Session model so the
// assignment survives students logging out/in (each login gets a brand new
// random sessionId, which would otherwise lose any per-session assignment).
const labAssignmentSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    activeModule: { type: mongoose.Types.ObjectId, ref: 'Module', default: null },
    slotKey: { type: String, default: null }, // e.g. "{moduleId}_2026-07-10_0900_1230"
    targetBatch: { type: String, default: '' },
    startTime: { type: String, default: '' }, // HH:MM
    endTime: { type: String, default: '' }, // HH:MM
    startsAt: { type: Date, default: null },
    sessionSlot: { type: String, default: '' }, // Legacy FN/AN
    durationMinutes: { type: Number, default: 60 }, // Legacy
    assignedAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['inactive', 'active', 'ended'],
      default: 'inactive',
    },
  },
  { timestamps: true }
);

export default mongoose.model('LabAssignment', labAssignmentSchema);
