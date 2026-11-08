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
