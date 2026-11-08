import { describe, it, expect } from 'vitest';
import { runAgent1Intake, runAgent2Classifier } from '../src/worker/agents';

async function rules(prompt: string) {
  // No GEMINI/OPENAI key in tests, so this is the rule-based path
  const { draft } = await runAgent1Intake(prompt);
  const c = await runAgent2Classifier(prompt, draft);
  return { draft, archetype: c.archetype };
}

describe('Rule-based bets: yes/no claims vs number windows', () => {
  it('"there will be a crash" in F1 is a YES/NO bet, not pit stops', async () => {
    const { draft, archetype } = await rules('lets bet on f1, i bet there will be a crash');
    expect(archetype).toBe('simple');
    expect(draft.unit).toBe('binary');
    expect(draft.question).toBe('Will there be a crash in the F1 race?');
  });

  it.each([
    'will there be a safety car in the grand prix?',
    'i bet verstappen wins the race',
    'will it rain tomorrow?',
  ])('%s -> YES/NO', async (prompt) => {
    const { draft, archetype } = await rules(prompt);
    expect(archetype).toBe('simple');
    expect(draft.unit).toBe('binary');
  });

  it('pit stop counts are still a window market in pit stops', async () => {
    const { draft, archetype } = await rules(
      'I want to make a market for pit stops in the f1 race tomorrow'
    );
    expect(archetype).toBe('spread');
    expect(draft.unit).toBe('pit stops');
  });

  it('"when will" questions are still a window market', async () => {
    const { archetype } = await rules('When will Arsenal score first vs Chelsea? 10 CHIP');
    expect(archetype).toBe('spread');
  });
});

import { closeHoursFromPrompt } from '../src/worker/agents';

describe('Close time from the message', () => {
  it.each([
    ['i bet it will rain in 10 minutes', 10 / 60],
    ['will it snow in 2 hours?', 2],
    ['who wins in 3 days', 72],
    ['pit stops next week', 168],
    ['will it rain in half an hour', 0.5],
  ])('%s -> %s h', (prompt, hours) => {
    expect(closeHoursFromPrompt(prompt)).toBeCloseTo(hours);
  });

  it('tomorrow closes at 11pm tomorrow; no time -> null', () => {
    const now = new Date(2026, 10, 8, 15, 0, 0);
    expect(closeHoursFromPrompt('will it snow tomorrow', now)).toBeCloseTo(8 + 24);
    expect(closeHoursFromPrompt('will there be a crash')).toBeNull();
  });

  it('the draft uses it, and keeps "it" in the question', async () => {
    const { draft } = await runAgent1Intake('i bet it will rain in 10 minutes');
    expect(draft.deadline_hours).toBeCloseTo(10 / 60);
    expect(draft.question).toBe('Will it rain in 10 minutes?');
  });
});
