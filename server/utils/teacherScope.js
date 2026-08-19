export const isAdmin = (user) => user?.role === 'admin';
export const teacherBatches = (user) => (user?.assignedBatches || []).map((batch) => String(batch).trim().toUpperCase()).filter(Boolean);
export const canAccessBatch = (user, batch) => isAdmin(user) || teacherBatches(user).includes(String(batch || '').trim().toUpperCase());
export const batchFilterFor = (user, field = 'name') => isAdmin(user) ? {} : { [field]: { $in: teacherBatches(user) } };
