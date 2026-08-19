import mongoose from 'mongoose';

const batchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    defaultPassword: { type: String, default: '' },
    studentIds: [{ type: String }],
    createdBy: { type: String, default: 'networklab' },
  },
  { timestamps: true }
);

export default mongoose.model('Batch', batchSchema);
