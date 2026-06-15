-- =============================================================================
-- Rules Test — placeholder question seed: 10 Safety + 30 General.
--
-- These are LASER-TAG-THEMED PLACEHOLDERS for the committee to replace with the
-- real laser-sailing safety + rules content. Every question text is prefixed
-- "PLACEHOLDER (...)" so they are obvious in the admin question manager.
--
-- Idempotent: each row is inserted only when no existing question shares the
-- same text, so re-running the migration never duplicates. Existing
-- (non-placeholder) questions are left completely untouched.
-- =============================================================================

INSERT INTO public.referee_questions
  (question, option_a, option_b, option_c, option_d, correct_answer, category, difficulty, section, active)
SELECT v.question, v.option_a, v.option_b, v.option_c, v.option_d, v.correct_answer, v.category, v.difficulty, v.section, true
FROM (VALUES
  -- ── SAFETY (10) — pass requires 100% ──────────────────────────────────────
  ('PLACEHOLDER (Safety): Where should you never aim your laser phaser?', 'At chest sensors', 'At a face or eyes', 'At wall targets', 'At the floor', 'b', 'Safety', 'easy', 'safety'),
  ('PLACEHOLDER (Safety): What must you wear during play?', 'The supplied protective gear and vest', 'Sandals', 'Loose jewellery', 'Nothing special', 'a', 'Safety', 'easy', 'safety'),
  ('PLACEHOLDER (Safety): You see a hazard on the arena floor. What do you do?', 'Ignore it', 'Keep running', 'Stop and alert a marshal immediately', 'Jump over it', 'c', 'Safety', 'easy', 'safety'),
  ('PLACEHOLDER (Safety): Running at full speed in the arena is:', 'Encouraged', 'Not allowed - move with control', 'Fine in the dark', 'Required to win', 'b', 'Safety', 'easy', 'safety'),
  ('PLACEHOLDER (Safety): Physical contact with other players is:', 'Part of the game', 'Not permitted', 'Allowed when tagging', 'Encouraged', 'b', 'Safety', 'easy', 'safety'),
  ('PLACEHOLDER (Safety): Before entering the arena you should:', 'Skip the briefing', 'Listen to the full safety briefing', 'Run in early', 'Turn off your vest', 'b', 'Safety', 'easy', 'safety'),
  ('PLACEHOLDER (Safety): A marshal calls stop and the lights come on. You:', 'Keep playing', 'Hide', 'Stop immediately and follow instructions', 'Argue', 'c', 'Safety', 'easy', 'safety'),
  ('PLACEHOLDER (Safety): Climbing on arena walls or obstacles is:', 'Allowed', 'A good tactic', 'Strictly prohibited', 'Only upstairs', 'c', 'Safety', 'easy', 'safety'),
  ('PLACEHOLDER (Safety): Emergency exits must be:', 'Blocked for defence', 'Kept clear at all times', 'Used as cover', 'Locked', 'b', 'Safety', 'easy', 'safety'),
  ('PLACEHOLDER (Safety): If you feel unwell or injured during play you should:', 'Keep playing', 'Tell a marshal and leave the arena', 'Hide it', 'Wait until the game ends', 'b', 'Safety', 'easy', 'safety'),

  -- ── GENERAL (30) — pass uses configurable threshold ───────────────────────
  ('PLACEHOLDER (General): How many points is a standard tag worth in this ruleset?', '1', '5', '10', 'It depends on the configured game mode', 'd', 'Scoring', 'medium', 'general'),
  ('PLACEHOLDER (General): After being tagged your vest is:', 'Out permanently', 'Temporarily deactivated for a few seconds', 'Awarded points', 'The winner', 'b', 'Rules', 'medium', 'general'),
  ('PLACEHOLDER (General): A timed match ends when:', 'The time limit is reached', 'Everyone leaves', 'The lights flicker', 'A player says stop', 'a', 'Rules', 'easy', 'general'),
  ('PLACEHOLDER (General): Tagging an opponent sensor scores points for:', 'The opponent', 'You', 'Nobody', 'The marshal', 'b', 'Scoring', 'easy', 'general'),
  ('PLACEHOLDER (General): Tagging your own teammate usually:', 'Scores you points', 'Deducts points or deactivates you', 'Wins the game', 'Does nothing', 'b', 'Rules', 'medium', 'general'),
  ('PLACEHOLDER (General): In base-defence mode the base is:', 'Decorative', 'A target worth bonus points', 'Off limits', 'The exit', 'b', 'Rules', 'medium', 'general'),
  ('PLACEHOLDER (General): Your phaser reload behaviour is governed by:', 'Buying ammo', 'The game-mode rules such as cooldown', 'Shaking it', 'It never reloads', 'b', 'Equipment', 'medium', 'general'),
  ('PLACEHOLDER (General): Team colours are used to:', 'Look nice', 'Identify friend versus foe', 'Confuse marshals', 'Nothing', 'b', 'General', 'easy', 'general'),
  ('PLACEHOLDER (General): If two players tag each other at the same instant:', 'Both deactivate per system rules', 'Neither counts', 'The taller wins', 'Replay the round', 'a', 'Rules', 'hard', 'general'),
  ('PLACEHOLDER (General): The winner of a free-for-all is the player with:', 'The most tags received', 'The highest score', 'The longest name', 'The brightest vest', 'b', 'Scoring', 'easy', 'general'),
  ('PLACEHOLDER (General): A referee signals a rule breach by:', 'Saying nothing', 'Using the agreed signal or call', 'Leaving', 'Tagging the player', 'b', 'General', 'medium', 'general'),
  ('PLACEHOLDER (General): Out-of-bounds areas are:', 'Fair play', 'Off limits during a match', 'Bonus zones', 'Where the base is', 'b', 'Rules', 'medium', 'general'),
  ('PLACEHOLDER (General): The respawn point is where you:', 'Exit the game', 'Reactivate after deactivation', 'Score double', 'Store gear', 'b', 'Rules', 'medium', 'general'),
  ('PLACEHOLDER (General): A player score is recorded by:', 'The honour system', 'The scoring system or referee', 'Other players', 'Nobody', 'b', 'Scoring', 'easy', 'general'),
  ('PLACEHOLDER (General): Camping the enemy respawn is usually:', 'Encouraged', 'Discouraged or against the rules', 'Worth bonus points', 'Required', 'b', 'Rules', 'medium', 'general'),
  ('PLACEHOLDER (General): If your equipment fails mid-match you should:', 'Keep playing anyway', 'Signal a referee', 'Swap with an opponent', 'Leave silently', 'b', 'Equipment', 'medium', 'general'),
  ('PLACEHOLDER (General): The objective in capture mode is to:', 'Tag the most walls', 'Capture or hold the objective', 'Run laps', 'Hide', 'b', 'Rules', 'easy', 'general'),
  ('PLACEHOLDER (General): Match results are final once:', 'A player disagrees', 'The referee confirms the scores', 'The lights go out', 'Someone leaves', 'b', 'General', 'medium', 'general'),
  ('PLACEHOLDER (General): Unsporting behaviour can result in:', 'A bonus', 'A warning or removal', 'Extra points', 'Nothing', 'b', 'General', 'medium', 'general'),
  ('PLACEHOLDER (General): The maximum players per team is set by:', 'The players', 'The event configuration', 'The arena size only', 'Random chance', 'b', 'Rules', 'medium', 'general'),
  ('PLACEHOLDER (General): A tie at the end of regulation is resolved by:', 'A coin toss only', 'The configured tie-break rule', 'Both teams lose', 'Replaying everything', 'b', 'Rules', 'hard', 'general'),
  ('PLACEHOLDER (General): Picking up another player phaser is:', 'Allowed any time', 'Not permitted unless the rules allow it', 'Worth points', 'Required', 'b', 'Equipment', 'medium', 'general'),
  ('PLACEHOLDER (General): The referee final decision is:', 'Open to debate mid-match', 'Final for that match', 'Ignored', 'Decided by vote', 'b', 'General', 'medium', 'general'),
  ('PLACEHOLDER (General): Sensors are typically located on the:', 'Shoes', 'Vest and phaser', 'Floor', 'Walls only', 'b', 'Equipment', 'easy', 'general'),
  ('PLACEHOLDER (General): A power-up in a game mode is:', 'Always available', 'A configured bonus you can collect', 'Banned', 'A penalty', 'b', 'Rules', 'medium', 'general'),
  ('PLACEHOLDER (General): Match length is set:', 'By the loudest player', 'In the event or game-mode settings', 'At random', 'By the arena temperature', 'b', 'Rules', 'easy', 'general'),
  ('PLACEHOLDER (General): If you are unsure of a rule you should:', 'Guess', 'Ask a referee before play', 'Make it up', 'Ignore it', 'b', 'General', 'easy', 'general'),
  ('PLACEHOLDER (General): Scores are usually displayed:', 'Never', 'On the scoreboard or system at match end', 'Only to winners', 'By shouting', 'b', 'Scoring', 'easy', 'general'),
  ('PLACEHOLDER (General): Entering the arena without a vest is:', 'Fine', 'Not allowed', 'A tactic', 'Encouraged', 'b', 'Rules', 'easy', 'general'),
  ('PLACEHOLDER (General): The purpose of this rules test is to:', 'Waste time', 'Confirm you understand the rules before refereeing or playing', 'Rank players', 'Nothing', 'b', 'General', 'easy', 'general')
) AS v(question, option_a, option_b, option_c, option_d, correct_answer, category, difficulty, section)
WHERE NOT EXISTS (
  SELECT 1 FROM public.referee_questions r WHERE r.question = v.question
);
