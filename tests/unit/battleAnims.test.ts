// Battle anim scripts: the ported sprite callbacks and tasks cover the scripts we expect to run.
// (Running them is checked end to end in tests/e2e/battleAnims.test.ts.)

import { beforeAll, describe, expect, test } from 'vitest';
import { battleAnimCoverage } from '../../src/battle/anim/battleAnim';
import { newBattleEnv } from './gameData';

let coverage: Record<string, string[]>;

beforeAll(async () => {
  await newBattleEnv();
  coverage = battleAnimCoverage();
});

// Scripts whose sprite callbacks and tasks are all ported. BATTLE_ANIMS_PLAN.md steps 2-3: each PR adds the
// labels it completes to its own C file's list, so PRs for different files don't touch the same lines. A label
// that needs two files goes in the list of whichever file lands second.
const FULLY_PORTED: Record<string, string[]> = {
  before: [
    'Move_POUND', 'Move_SCRATCH', 'Move_TACKLE', 'Move_GROWL', 'Move_TAIL_WHIP', 'Move_LEER', 'Move_EMBER',
    'Move_WATER_GUN', 'Move_VINE_WHIP', 'Move_BUBBLE', 'Move_THUNDER_SHOCK', 'Move_QUICK_ATTACK',
    'Move_SAND_ATTACK', 'Move_GUST', 'Move_PECK', 'Move_STRING_SHOT', 'Move_POISON_STING', 'Move_HARDEN',
    'Move_BITE', 'Move_SUPERSONIC', 'Move_ABSORB', 'Move_LEECH_SEED', 'Move_POISON_POWDER', 'Move_SLEEP_POWDER',
    'Move_STUN_SPORE', 'Move_THUNDER_WAVE', 'Move_FLAMETHROWER',
    'Status_Poison', 'Status_Confusion', 'Status_Burn', 'Status_Infatuation', 'Status_Sleep', 'Status_Paralysis',
    'Status_Freeze', 'Status_Curse', 'Status_Nightmare',
    'General_StatsChange', 'General_MonHit', 'General_BaitThrow', 'General_SafariRockThrow', 'General_SubstituteFade',
    'General_SubstituteAppear',
    // battle anims step 1 (BATTLE_ANIMS_PLAN.md)
    'Move_AERIAL_ACE', 'Move_BARRIER', 'Move_BEAT_UP', 'Move_BONE_CLUB', 'Move_BONE_RUSH', 'Move_CHARM',
    'Move_COMET_PUNCH', 'Move_CONFUSION', 'Move_CONSTRICT', 'Move_COSMIC_POWER', 'Move_COUNTER', 'Move_COVET',
    'Move_CRUSH_CLAW', 'Move_CUT', 'Move_DRAGON_CLAW', 'Move_DREAM_EATER', 'Move_DYNAMIC_PUNCH', 'Move_ENDURE',
    'Move_FIRE_SPIN', 'Move_FOCUS_ENERGY', 'Move_FURY_ATTACK', 'Move_FUTURE_SIGHT', 'Move_HEADBUTT',
    'Move_HI_JUMP_KICK', 'Move_HORN_ATTACK', 'Move_HORN_DRILL', 'Move_HYPNOSIS', 'Move_ICICLE_SPEAR',
    'Move_JUMP_KICK', 'Move_LIGHT_SCREEN', 'Move_LOW_KICK', 'Move_MACH_PUNCH', 'Move_MAGIC_COAT', 'Move_METAL_CLAW',
    'Move_MIRROR_COAT', 'Move_MIST', 'Move_MUDDY_WATER', 'Move_PIN_MISSILE', 'Move_PSYBEAM', 'Move_PSYCHIC',
    'Move_PSYWAVE', 'Move_RAGE', 'Move_RAIN_DANCE', 'Move_REFLECT', 'Move_ROCK_SLIDE', 'Move_ROCK_THROW',
    'Move_ROLLING_KICK', 'Move_SAND_TOMB', 'Move_SHADOW_PUNCH', 'Move_SMOG', 'Move_STEEL_WING', 'Move_SUNNY_DAY',
    'Move_SURF', 'Move_SYNTHESIS', 'Move_TRANSFORM', 'Move_TRIPLE_KICK', 'Move_WHIRLPOOL', 'Move_WING_ATTACK',
    'General_FocusPunchSetUp', 'General_FutureSightHit', 'General_HeldItemEffect', 'General_Rain',
    'General_SafariReaction', 'General_SilphScoped', 'General_Sun', 'General_TurnTrap', 'General_WishHeal',
    // every special anim: InitAndLaunchSpecialAnimation has no fallback
    'Special_LevelUp', 'Special_SwitchOutPlayerMon', 'Special_SwitchOutOpponentMon', 'Special_BallThrow',
    'Special_BallThrowWithTrainer', 'Special_SubstituteToMon', 'Special_MonToSubstitute',
  ],

  // battle_anim_fight.c
  fight: [
    'Move_KARATE_CHOP', 'Move_STOMP', 'Move_DOUBLE_KICK', 'Move_DIZZY_PUNCH', 'Move_CROSS_CHOP', 'Move_SUPERPOWER',
    'Move_REVENGE', 'Move_BRICK_BREAK', 'Move_ARM_THRUST', 'Move_SKY_UPPERCUT',
  ],

  // battle_anim_rock.c
  rock: [
    'Move_SEISMIC_TOSS', 'Move_SANDSTORM', 'Move_ROLLOUT', 'Move_ANCIENT_POWER', 'Move_ROCK_SMASH', 'Move_ROCK_BLAST',
    'General_Sandstorm',
  ],

  // battle_anim_ground.c
  ground: ['Move_EARTHQUAKE', 'Move_FISSURE', 'Move_DIG', 'Move_BONEMERANG', 'Move_MAGNITUDE'],

  // battle_anim_bug.c
  bug: ['Move_LEECH_LIFE', 'Move_SPIDER_WEB', 'Move_MEGAHORN', 'Move_TAIL_GLOW'],

  // battle_anim_poison.c
  poison: ['Move_ACID', 'Move_SLUDGE', 'Move_SLUDGE_BOMB'],

  // battle_anim_water.c
  water: [],

  // battle_anim_ice.c
  ice: [],

  // battle_anim_dragon.c
  dragon: [],

  // battle_anim_fire.c
  fire: [],

  // battle_anim_electric.c
  electric: [],

  // battle_anim_flying.c
  flying: [],

  // battle_anim_ghost.c
  ghost: [],

  // battle_anim_psychic.c
  psychic: [],

  // battle_anim_dark.c
  dark: [],

  // battle_anim_effects_1.c
  effects1: [],

  // battle_anim_effects_2.c
  effects2: [],

  // battle_anim_effects_3.c
  effects3: [],
};

describe('battle anim coverage', () => {
  test.each(Object.values(FULLY_PORTED).flat())('%s is fully ported', (label) => {
    expect(coverage[label]).toEqual([]);
  });

  test('every script resolves (no unknown commands or C symbols)', () => {
    // 355 moves (Move_NONE / Mirror Move / Pound share one script, as do a few others) + status,
    // general and special anims; building the coverage walks every script and template.
    expect(Object.keys(coverage).length).toBe(397);
  });
});
