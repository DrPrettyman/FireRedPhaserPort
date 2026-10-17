// trainer_pokemon_sprites.c: front/back pic sprites outside battle (summary screen, Hall of Fame,
// trainer card). ignoreDeoxys has no effect: FireRed's Deoxys pic is its Normal form either way.

import { K } from '../battle/constants';
import { bdata } from '../battle/env';
import { animTable, DecompressPicFromTable, GetMonSpritePalFromSpeciesAndPersonality, GetMonSpritePalStructFromOtIdPersonality, LoadSpecialPokePic } from '../battle/gfx';
import { gfx16 } from '../gba/gfx';
import { BG_PLTT_ID, LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP } from '../gba/palette';
import {
  CreateSprite,
  DestroySprite,
  FreeSpritePaletteByTag,
  gDummySpriteAffineAnimTable,
  GetSpritePaletteTagByPaletteNum,
  gSprites,
  LoadCompressedSpritePalette,
  oam,
  SPRITE_SHAPE,
  TAG_NONE,
  type Sprite,
  type SpriteFrameImage,
  type SpriteTemplate,
} from '../gba/sprite';
import { BlitBitmapRectToWindow } from '../gba/window';

interface PicData {
  frames: Uint8Array | null;
  images: SpriteFrameImage[] | null;
  paletteTag: number;
  spriteId: number;
  active: boolean;
}

const PICS_COUNT = 8;
const sDummyPicData = (): PicData => ({ frames: null, images: null, paletteTag: 0, spriteId: 0, active: false });
const sSpritePics: PicData[] = Array.from({ length: PICS_COUNT }, sDummyPicData);

const sOamData_Normal = oam({ shape: SPRITE_SHAPE['64x64'][0], size: SPRITE_SHAPE['64x64'][1] });

export function DummyPicSpriteCallback(_sprite: Sprite): void {}

export function ResetAllPicSprites(): boolean {
  for (let i = 0; i < PICS_COUNT; i++) sSpritePics[i] = sDummyPicData();
  return false;
}

function CreatePicSprite(species: number, otId: number, personality: number, isFrontPic: boolean, x: number, y: number, paletteSlot: number, paletteTag: number, isTrainer: boolean): number {
  if (isTrainer && !isFrontPic) {
    console.warn('[trainer_pokemon_sprites] trainer back pic sprites are not implemented');
    return 0xffff;
  }
  let i = 0;
  for (; i < PICS_COUNT; i++) if (!sSpritePics[i].active) break;
  if (i === PICS_COUNT) return 0xffff;

  const framePics = new Uint8Array(4 * 0x800);
  // DecompressPic: gTrainerFrontPicTable[species] for a trainer (`species` is the TRAINER_PIC_* id)
  if (isTrainer) DecompressPicFromTable(bdata.anims.trainerFrontPics[species]!.pic, framePics);
  else LoadSpecialPokePic(isFrontPic, species, personality, framePics);
  const images: SpriteFrameImage[] = [0, 1, 2, 3].map((j) => ({ data: framePics.subarray(0x800 * j, 0x800 * (j + 1)), size: 0x800 }));
  const template: SpriteTemplate = {
    tileTag: TAG_NONE,
    paletteTag: TAG_NONE,
    oam: sOamData_Normal,
    // AssignSpriteAnimsTable: gTrainerFrontAnimsPtrTable[0] for trainers
    anims: animTable('data.c', isTrainer ? bdata.anims.units['data.c'].tableTables['gTrainerFrontAnimsPtrTable']![0]! : 'gAnims_MonPic'),
    images,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: DummyPicSpriteCallback,
  };
  // LoadPicPaletteByTagOrSlot
  if (isTrainer) {
    const pal = gfx16(bdata.anims.trainerFrontPalettes[species]!);
    if (paletteTag === TAG_NONE) LoadPalette(pal, OBJ_PLTT_ID(paletteSlot), PLTT_SIZE_4BPP);
    else {
      template.paletteTag = paletteTag;
      LoadCompressedSpritePalette({ data: pal, tag: species }); // gTrainerFrontPicPaletteTable[species] is tagged with the id
    }
  } else if (paletteTag === TAG_NONE) {
    LoadPalette(GetMonSpritePalFromSpeciesAndPersonality(species, otId, personality), OBJ_PLTT_ID(paletteSlot), PLTT_SIZE_4BPP);
  } else {
    const pal = GetMonSpritePalStructFromOtIdPersonality(species, otId, personality);
    template.paletteTag = pal.tag;
    LoadCompressedSpritePalette(pal);
  }
  const spriteId = CreateSprite(template, x, y, 0);
  if (paletteTag === TAG_NONE) gSprites[spriteId].oam.paletteNum = paletteSlot;
  sSpritePics[i] = { frames: framePics, images, paletteTag, spriteId, active: true };
  return spriteId;
}

function FreeAndDestroyPicSpriteInternal(spriteId: number): number {
  let i = 0;
  for (; i < PICS_COUNT; i++) if (sSpritePics[i].spriteId === spriteId) break;
  if (i === PICS_COUNT) return 0xffff;
  if (sSpritePics[i].paletteTag !== TAG_NONE) FreeSpritePaletteByTag(GetSpritePaletteTagByPaletteNum(gSprites[spriteId].oam.paletteNum));
  DestroySprite(gSprites[spriteId]);
  sSpritePics[i] = sDummyPicData();
  return 0;
}

export function CreateMonPicSprite(species: number, otId: number, personality: number, isFrontPic: boolean, x: number, y: number, paletteSlot: number, paletteTag: number, _ignoreDeoxys: boolean): number {
  return CreatePicSprite(species, otId, personality, isFrontPic, x, y, paletteSlot, paletteTag, false);
}

export function CreateMonPicSprite_HandleDeoxys(species: number, otId: number, personality: number, isFrontPic: boolean, x: number, y: number, paletteSlot: number, paletteTag: number): number {
  return CreateMonPicSprite(species, otId, personality, isFrontPic, x, y, paletteSlot, paletteTag, false);
}

export function FreeAndDestroyMonPicSprite(spriteId: number): number {
  return FreeAndDestroyPicSpriteInternal(spriteId);
}

/** CreateTrainerPicSprite: `species` is the TRAINER_PIC_* id. */
export function CreateTrainerPicSprite(species: number, isFrontPic: boolean, x: number, y: number, paletteSlot: number, paletteTag: number): number {
  return CreatePicSprite(species, 0, 0, isFrontPic, x, y, paletteSlot, paletteTag, true);
}

export function FreeAndDestroyTrainerPicSprite(spriteId: number): number {
  return FreeAndDestroyPicSpriteInternal(spriteId);
}

/** LoadPicPaletteBySlot: the pic's palette into BG palette `paletteSlot`. */
function LoadPicPaletteBySlot(species: number, otId: number, personality: number, paletteSlot: number, isTrainer: boolean): void {
  if (!isTrainer) LoadPalette(GetMonSpritePalFromSpeciesAndPersonality(species, otId, personality), BG_PLTT_ID(paletteSlot), PLTT_SIZE_4BPP);
  else LoadPalette(gfx16(bdata.anims.trainerFrontPalettes[species]!), BG_PLTT_ID(paletteSlot), PLTT_SIZE_4BPP);
}

/** CreateTrainerCardSprite: the 64x64 pic drawn into a window's pixels at (destX, destY), its palette into BG palette `paletteSlot`. */
function CreateTrainerCardSprite(species: number, otId: number, personality: number, isFrontPic: boolean, destX: number, destY: number, paletteSlot: number, windowId: number, isTrainer: boolean): number {
  if (isTrainer && !isFrontPic) {
    console.warn('[trainer_pokemon_sprites] trainer back pics are not implemented');
    return 0xffff;
  }
  const framePics = new Uint8Array(4 * 0x800);
  // DecompressPic_HandleDeoxys
  if (isTrainer) DecompressPicFromTable(bdata.anims.trainerFrontPics[species]!.pic, framePics);
  else LoadSpecialPokePic(isFrontPic, species, personality, framePics);
  BlitBitmapRectToWindow(windowId, framePics, 0, 0, 0x40, 0x40, destX, destY, 0x40, 0x40);
  LoadPicPaletteBySlot(species, otId, personality, paletteSlot, isTrainer);
  return 0;
}

/** CreateTrainerCardTrainerPicSprite: `species` is the TRAINER_PIC_* id. */
export function CreateTrainerCardTrainerPicSprite(species: number, isFrontPic: boolean, destX: number, destY: number, paletteSlot: number, windowId: number): number {
  return CreateTrainerCardSprite(species, 0, 0, isFrontPic, destX, destY, paletteSlot, windowId, true);
}

/** PlayerGenderToFrontTrainerPicId(gender, TRUE): gFacilityClassToPicIndex[FACILITY_CLASS_RED / LEAF] */
export function PlayerGenderToFrontTrainerPicId(gender: number): number {
  return gender !== K.MALE ? K.TRAINER_PIC_LEAF : K.TRAINER_PIC_RED;
}
