// The working day before a date due: when a reminder goes out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datesRemindedOn, reminderDay } from '../../src/quoting/reminders.ts';

test('a reminder goes out the working day before', () => {
  assert.equal(reminderDay('2026-10-23'), '2026-10-22', 'Friday: Thursday');
  assert.equal(reminderDay('2026-10-27'), '2026-10-26', 'Tuesday: Monday');
  assert.equal(reminderDay('2026-10-26'), '2026-10-23', 'Monday: the Friday before');
  assert.equal(reminderDay('2026-10-25'), '2026-10-23', 'Sunday: Friday');
  assert.equal(reminderDay('2026-10-24'), '2026-10-23', 'Saturday: Friday');
  assert.equal(reminderDay('2026-11-01'), '2026-10-30', 'across a month');
  assert.equal(reminderDay('2027-01-01'), '2026-12-31', 'across a year');
});

test('on a Friday the weekend and Monday are reminded of; on the weekend nothing', () => {
  assert.deepEqual(datesRemindedOn('2026-10-22'), ['2026-10-23']);
  assert.deepEqual(datesRemindedOn('2026-10-23'), ['2026-10-24', '2026-10-25', '2026-10-26']);
  assert.deepEqual(datesRemindedOn('2026-10-24'), []);
  assert.deepEqual(datesRemindedOn('2026-10-25'), []);
});
