import { readFileSync } from "node:fs";

/* ==========================================================================
   Realistic, connected demo data used by both the seed script and the
   admin-only POST /api/seed endpoint. Everything is upserted by stable keys,
   so running it repeatedly is safe.

   Connected entities: tutors (user docs) -> tuitions (courses) -> applications
   (bookings) -> reviews, plus a few student users for the applications.
   ========================================================================== */

const dataset = JSON.parse(
  readFileSync(new URL("../scripts/seed-data.json", import.meta.url), "utf8")
);
const tutors = dataset.tutors.map((tutor) => ({ ...tutor }));
const students = dataset.students.map((student) => ({ ...student }));
const tuitions = dataset.tuitions;

function numeric(value) {
  const parsed = Number.parseFloat(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function seedDemoData(db) {
  const userCollection = db.collection("user");
  const courseCollection = db.collection("courses");
  const bookingCollection = db.collection("bookings");
  const reviewCollection = db.collection("reviews");

  let users = 0;
  let posted = 0;
  let applications = 0;
  let testimonials = 0;

  // 1. Connected identities. Seeded users use a fixed email so tutor posts can
  //    be linked through tutorEmail even when the ids differ.
  for (const [index, tutor] of tutors.entries()) {
    const result = await userCollection.updateOne(
      { email: tutor.email },
      {
        $set: {
          name: tutor.name,
          role: "tutor",
          plan: "free",
          image: "",
          bio: "Experienced tutor sharing practical, exam-focused lessons.",
        },
        $setOnInsert: { createdAt: new Date().toISOString() },
      },
      { upsert: true }
    );
    if (result.upsertedCount) users += 1;
    tutor.id = `seed-tutor-${index}`;
  }
  for (const student of students) {
    const result = await userCollection.updateOne(
      { email: student.email },
      {
        $set: { name: student.name, role: "student", plan: "free", image: "" },
        $setOnInsert: { createdAt: new Date().toISOString() },
      },
      { upsert: true }
    );
    if (result.upsertedCount) users += 1;
  }

  // 2. Tuitions, linked to the tutor identities above.
  const seededIds = [];
  for (const [index, row] of tuitions.entries()) {
    const [title, subject, classLevel, mode, fee, days, slots, location, tutorIndex] = row;
    const tutor = tutors[tutorIndex];
    const createdAt = new Date(Date.now() - (tuitions.length - index) * 86400000).toISOString();
    const result = await courseCollection.updateOne(
      { title },
      {
        $set: {
          title,
          subject,
          classLevel,
          mode,
          fee,
          monthlyFee: fee,
          feeValue: numeric(fee),
          days,
          daysPerWeek: days,
          daysValue: numeric(days),
          slots,
          location,
          bannerName: "",
          bannerUrl: "",
          bannerImage: "",
          description: `A focused ${subject} batch with weekly practice, worked examples and personal feedback.`,
          status: "approved",
          approvalStatus: "approved",
          isActive: true,
          tutorId: tutor.id,
          tutorEmail: tutor.email,
          tutorName: tutor.name,
          tutorImage: "",
          rating: 4.5 + (index % 5) / 10,
          reviews: 8 + index * 3,
          createdAt,
          reviewedAt: createdAt,
          reviewedBy: "seed-admin",
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount) posted += 1;
    const saved = await courseCollection.findOne({ title });
    seededIds.push(String(saved._id));
  }

  // 3. Applications connected to both students and tuitions, with a spread of
  //    statuses so dashboards and the review flow have real data to show.
  const statuses = dataset.applicationStatuses;
  for (let index = 0; index < tuitions.length; index += 1) {
    const student = students[index % students.length];
    const row = tuitions[index];
    const status = statuses[index % statuses.length];
    const result = await bookingCollection.updateOne(
      { tuitionId: seededIds[index], studentEmail: student.email, slotId: row[6][0] },
      {
        $set: {
          tuitionId: seededIds[index],
          tuitionTitle: row[0],
          subject: row[1],
          monthlyFee: row[4],
          slotId: row[6][0],
          slotLabel: "Morning Batch",
          studentId: `seed-student-${index % students.length}`,
          studentName: student.name,
          studentEmail: student.email,
          studentPhone: "+1 555 0100",
          tutorId: tutors[row[8]].id,
          tutorEmail: tutors[row[8]].email,
          status,
          applicationStatus: status === "rejected" ? "rejected" : status,
          appliedAt: new Date(Date.now() - index * 86400000).toISOString(),
          createdAt: new Date(Date.now() - index * 86400000).toISOString(),
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount) applications += 1;
  }

  // 4. Testimonials from accepted students.
  const comments = dataset.comments;
  for (let index = 0; index < comments.length; index += 1) {
    const tuitionIndex = statuses.indexOf("accepted", index);
    if (tuitionIndex < 0) break;
    const row = tuitions[tuitionIndex];
    const tutor = tutors[row[8]];
    const student = students[tuitionIndex % students.length];
    const result = await reviewCollection.updateOne(
      { tuitionId: seededIds[tuitionIndex], studentEmail: student.email },
      {
        $set: {
          tuitionId: seededIds[tuitionIndex],
          tutorId: tutor.id,
          tutorName: tutor.name,
          subject: row[1],
          studentId: `seed-student-${tuitionIndex % students.length}`,
          studentName: student.name,
          rating: 5 - (index % 2),
          comment: comments[index],
          createdAt: new Date(Date.now() - index * 86400000).toISOString(),
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount) testimonials += 1;
  }

  return {
    users,
    tuitions: posted,
    applications,
    reviews: testimonials,
  };
}
