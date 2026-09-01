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
    { ...BASE_PROJECT, id: "p0", projectType: "ต่อเติม", projectDetail: "ต่อเติมครัวหลังบ้าน", location: "นนทบุรี" },
  ]);
  assert.match(note!, /ต่อเติม \/ ต่อเติมครัวหลังบ้าน \/ นนทบุรี/);
  assert.match(note!, /ถามยืนยัน/);
  assert.match(note!, /needsHuman = true/);
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

test("hasEnoughInfoForHandoff needs both a phone and a project type", () => {
  assert.equal(hasEnoughInfoForHandoff({ phone: null, projectType: null }), false);
  assert.equal(hasEnoughInfoForHandoff({ phone: "081-234-5678", projectType: null }), false);
  assert.equal(hasEnoughInfoForHandoff({ phone: null, projectType: "ต่อเติม" }), false);
  assert.equal(hasEnoughInfoForHandoff({ phone: "081-234-5678", projectType: "ต่อเติม" }), true);
});
