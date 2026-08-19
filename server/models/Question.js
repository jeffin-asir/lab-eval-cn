import mongoose from "mongoose";

const fileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // base filename, no extension (e.g. "server", not "server.c")
    tag: { type: String, required: true },
    // Per-language starter code, keyed by the languages this platform
    // supports ('c', 'java'). Mixed (rather than a strict sub-schema) so
    // older questions saved before this field existed a plain string don't
    // fail validation on read — see the toJSON transform below, which
    // normalizes those into this shape for every consumer.
    precode: { type: mongoose.Schema.Types.Mixed, default: () => ({ c: '', java: '' }) },
  },
  {
    _id: false,
    toJSON: {
      transform: (_doc, ret) => {
        // Pre-migration questions stored precode as a single string that
        // implicitly matched whatever extension `name` had (e.g.
        // name: "server.c", precode: "..."). Normalize both here so every
        // consumer (teacher form, student workspace) only ever has to
        // handle the new { c, java } / extension-less shape.
        const legacyLang = /\.java$/i.test(ret.name || '') ? 'java' : 'c';
        if (typeof ret.precode === 'string') {
          ret.precode = { c: '', java: '', [legacyLang]: ret.precode };
        } else if (!ret.precode || typeof ret.precode !== 'object') {
          ret.precode = { c: '', java: '' };
        } else {
          ret.precode = { c: '', java: '', ...ret.precode };
        }
        if (ret.name) {
          ret.name = ret.name.replace(/\.(c|java)$/i, '');
        }
        return ret;
      },
    },
  }
);

const baseQuestionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    course: { type: mongoose.Types.ObjectId, ref: "Course" },
    lab: { type: String },
    tags: [{ type: String }],
    maxMarks: { type: Number, default: 15 },
    moduleType: { type: String, required: true },
    createdBy: { type: mongoose.Types.ObjectId, ref: "User" },
    creatorId: { type: String },
    details: { type: Object, default: {} },
    resources: [{
      name: { type: String, required: true },
      url: { type: String, required: true },
      mimeType: { type: String, default: '' },
    }],
  },
  { timestamps: true, discriminatorKey: "moduleType" }
);

const Question = mongoose.model("Question", baseQuestionSchema);

const CNQuestionSchema = new mongoose.Schema(
  {
    questionKey: { type: String, default: "q1" },
    files: [fileSchema],
    testcases: { type: mongoose.Schema.Types.Mixed, required: true },
    // The evaluator consumes these exact files.  `testcases`/`evalScript` are
    // retained as compatibility data for the guided editors, but are never
    // used by the backend to reconstruct the files at evaluation time.
    testcasesFile: { type: String, default: '' },
    // Socket counts drive the teacher's guided testcase builder. Directions
    // are intentionally independent from code-file tags.
    testcaseSocketConfig: {
      clients: { type: Number, default: 1, min: 0 },
      servers: { type: Number, default: 1, min: 0 },
    },
    input: { type: String, default: "" },
    evalScript: { type: String, required: true },
    niceScript: { type: String, default: '' },
    // Scratch-like flow blocks for nice.sh; evalScript holds generated body text.
    evalScriptBlocks: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const CNQuestion = Question.discriminator("CNQuestion", CNQuestionSchema);

export { Question, CNQuestion };
