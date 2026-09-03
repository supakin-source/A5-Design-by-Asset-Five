import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatKnownFields,
  formatPriorProjectsNote,
  hasEnoughInfoForHandoff,
  startsNewProject,
} from "../src/lib/lead";
import { ProjectStatus, type Lead, type Project } from "@prisma/client";

const BASE_PROJECT: Project = {
  id: "p1",
  leadId: "l1",
  phone: null,
  projectType: null,
  projectDetail: null,
  budgetRange: null,
  location: null,
  timeline: null,
  contactNote: null,
  notes: null,
  status: ProjectStatus.NEW,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const BASE_LEAD: Lead = {
  id: "l1",
  lineUserId: "U1",
  displayName: null,
  consentShownAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

test("formatKnownFields is undefined when nothing has been collected yet", () => {
  assert.equal(formatKnownFields(BASE_LEAD, BASE_PROJECT), undefined);
});

test("formatKnownFields lists only the fields that are actually set", () => {
  const text = formatKnownFields(
    { ...BASE_LEAD, displayName: "สมชาย" },
    { ...BASE_PROJECT, phone: "081-234-5678", projectType: "ต่อเติม" },
  );
  assert.match(text!, /ชื่อลูกค้า: สมชาย/);
  assert.match(text!, /เบอร์ติดต่อ: 081-234-5678/);
  assert.match(text!, /ประเภทงาน: ต่อเติม/);
  assert.doesNotMatch(text!, /งบประมาณ/);
});

test("formatPriorProjectsNote is undefined with no prior settled projects", () => {
  assert.equal(formatPriorProjectsNote([]), undefined);
});

test("formatPriorProjectsNote lists each prior project and tells the model to confirm before re-collecting", () => {
  const note = formatPriorProjectsNote([
    {
      ...BASE_PROJECT,
      id: "p0",
      status: ProjectStatus.HANDED_OFF,
      projectType: "ต่อเติม",
      projectDetail: "ต่อเติมครัวหลังบ้าน",
      location: "นนทบุรี",
    },
  ]);
  assert.match(note!, /ต่อเติม \/ ต่อเติมครัวหลังบ้าน \/ นนทบุรี/);
  assert.match(note!, /ถามยืนยัน/);
  assert.match(note!, /needsHuman = true/);
});

test("formatPriorProjectsNote tells the model to answer a callback complaint from the real status, not by asking old-vs-new", () => {
  const notYetContacted = formatPriorProjectsNote([
    { ...BASE_PROJECT, id: "p0", status: ProjectStatus.HANDED_OFF, projectType: "สร้างบ้านใหม่" },
  ]);
  assert.match(notYetContacted!, /ทีมงานยังไม่ได้ติดต่อกลับ/);

  const alreadyContacted = formatPriorProjectsNote([
    { ...BASE_PROJECT, id: "p0", status: ProjectStatus.CONTACTED, projectType: "สร้างบ้านใหม่" },
  ]);
  assert.match(alreadyContacted!, /ทีมงานติดต่อไปแล้ว/);
});

test("a closed job reopens as a new project immediately; the rest wait out the gap", () => {
  const seconds = 30 * 1000;
  const twoHours = 2 * 60 * 60 * 1000;

  // Staff marked it finished, so the next message is new business — no wait.
  assert.equal(startsNewProject(ProjectStatus.CLOSED, seconds), true);
  assert.equal(startsNewProject(ProjectStatus.CLOSED, twoHours), true);

  // Still-live jobs: a customer who keeps chatting stays on the same project,
  // which is what stops the mid-conversation duplicate-row bug.
  assert.equal(startsNewProject(ProjectStatus.HANDED_OFF, seconds), false);
  assert.equal(startsNewProject(ProjectStatus.CONTACTED, seconds), false);
  assert.equal(startsNewProject(ProjectStatus.HANDED_OFF, twoHours), true);
  assert.equal(startsNewProject(ProjectStatus.CONTACTED, twoHours), true);

  // A job still being filled in is never split, however long the pause.
  assert.equal(startsNewProject(ProjectStatus.NEW, twoHours), false);
});

test("hasEnoughInfoForHandoff needs contact + project type + at least one substantive detail", () => {
  const BASE = {
    phone: "081-234-5678",
    projectType: "ต่อเติม",
    projectDetail: null as string | null,
    budgetRange: null as string | null,
    location: null as string | null,
  };
  // Contact + project type alone used to be enough — this is exactly the bug
  // that fired a staff notification full of "(ไม่ระบุ)" for everything else.
  assert.equal(hasEnoughInfoForHandoff(BASE), false);
  assert.equal(hasEnoughInfoForHandoff({ phone: null, projectType: null, projectDetail: null, budgetRange: null, location: null }), false);
  // Any single substantive field is enough — requiring all three over-corrected:
  // a customer redecorating a specific condo unit has no "location" to give
  // beyond the unit itself, and got no notification at all under that rule.
  assert.equal(hasEnoughInfoForHandoff({ ...BASE, budgetRange: "1-3 ล้าน" }), true);
  assert.equal(hasEnoughInfoForHandoff({ ...BASE, location: "กรุงเทพฯ" }), true);
  assert.equal(hasEnoughInfoForHandoff({ ...BASE, projectDetail: "ตกแต่งภายในคอนโด" }), true);
});
