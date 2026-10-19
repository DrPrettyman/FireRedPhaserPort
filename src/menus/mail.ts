// mail.c: the mail screen (ReadMail). BG1 is the mail type's picture (graphics/mail/<type>, through the extractor),
// BG2 a fill of tile 1 behind it, BG0 the two text windows: the message (the easy chat words, five rows of two words in
// FRLG's 5x2 arrangement, sMessageLayouts_5x2) and "From <name>". The text colours 10 / 11 of palette 15 are the mail
// type's textpals; colours 10 / 11 of BG palette 0 the player's gender colours (sGenderPals). Bead and Dream Mail
// show the mon's icon (MailSpeciesToIconSpecies). A or B fades out back to `savedCallback`.
// Callers: the party menu's MAIL → READ (CB2_ReadHeldMail), the bag's CHECK on a mail item (FieldUseFunc_Mail: a
// blank mail, no message), the player's PC mailbox's READ (ui/PlayerPcMenu.ts: Task_WaitFadeAndReadSelectedMail).

import { K } from '../battle/constants';
import { state } from '../battle/env';
import {
  CopyBgTilemapBufferToVram,
  CopyToBgTilemapBuffer,
  FillBgTilemapBufferRect_Palette0,
  InitBgsFromTemplates,
  ResetBgsAndClearDma3BusyFlags,
  SetBgTilemapBuffer,
  ShowBg,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  DISPCNT_MODE_0,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  PALETTES_ALL,
  REG_OFFSET_BG0HOFS,
  REG_OFFSET_BG0VOFS,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BG2VOFS,
  REG_OFFSET_BG3HOFS,
  REG_OFFSET_BG3VOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_DISPCNT,
  RGB,
  RGB_BLACK,
  SetGpuReg,
} from '../gba/hw';
import { A_BUTTON, B_BUTTON, gMain, JOY_NEW, SetMainCallback2, SetVBlankCallback, type MainCallback } from '../gba/main';
import { DecompressAndCopyTileDataToVram, FreeTempTileDataBuffersIfPossible, GetTextWindowPalette, MenuHelpers_IsLinkActive, ResetTempTileDataBuffers } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, gPaletteFade, gPlttBufferFaded, gPlttBufferUnfaded, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { AnimateSprites, BuildOamBuffer, FreeAllSpritePalettes, gSprites, ProcessSpriteCopyRequests, ResetSpriteData, SpriteCallbackDummy } from '../gba/sprite';
import { ResetTasks } from '../gba/task';
import {
  AddTextPrinterParameterized3,
  COPYWIN_FULL,
  CopyWindowToVram,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FreeAllWindowBuffers,
  GetStringWidth,
  InitWindows,
  PIXEL_FILL,
  PutWindowTilemap,
  RunTextPrinters,
  type WindowTemplate,
} from '../gba/window';
import { SetHelpContext } from '../ui/helpSystemContext';
import { gPlayerPcMenuManager, MailSpeciesToIconSpecies, MailSpeciesToSpecies, type Mail } from '../world/mail';
import { EOS, text } from './common';
import { ConvertEasyChatWordsToString } from './easyChat';
import { CreateMonIcon_HandleDeoxys, DestroyMonIcon, FreeMonIconPalette, LoadMonIconPalette, monIconSymbol } from './pokemonIcon';

const FONT_NORMAL_COPY_1 = 1; // the port's fonts fall back to FONT_NORMAL for the copies
const CHAR_SPACE = 0x00;

/** enum MailIconParam */
const MAIL_ICON_NONE = 0;
const MAIL_ICON_BEAD = 1;
const MAIL_ICON_DREAM = 2;

/** struct MailEcWordLayout */
interface MailEcWordLayout {
  numWordsInLine: number;
  lineXoffset: number;
  lineHeight: number;
}

/** struct MailAttrStruct */
interface MailAttrStruct {
  numRows: number;
  nameY: number;
  nameX: number;
  messageTop: number;
  messageLeft: number;
  linesLayout: MailEcWordLayout[];
}

/** struct MailGfxData (the graphics as extracted symbol names) */
interface MailGfxData {
  pal: string;
  tiles: string;
  map: string;
  size: number;
  textpals: [number, number];
}

/** struct MailViewResources */
interface MailViewResources {
  messageLinesBuffer: number[][];
  authorNameBuffer: number[];
  savedCallback: MainCallback;
  showMailCallback: () => void;
  mail: Mail;
  messageExists: boolean;
  nameX: number;
  mailType: number;
  monIconType: number;
  monIconSpriteId: number;
  unused: number;
  mailArrangementType: number;
  messageLayout: MailAttrStruct;
  bg1TilemapBuffer: Uint16Array;
  bg2TilemapBuffer: Uint16Array;
}

let sMailViewResources: MailViewResources | null = null;

const sBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 2, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0x000 },
  { bg: 1, charBaseIndex: 0, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0x000 },
  { bg: 2, charBaseIndex: 0, mapBaseIndex: 29, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0x000 },
];

const sWindowTemplates: WindowTemplate[] = [
  { bg: 0, tilemapLeft: 3, tilemapTop: 4, width: 24, height: 10, paletteNum: 15, baseBlock: 0x001 },
  { bg: 0, tilemapLeft: 15, tilemapTop: 15, width: 13, height: 3, paletteNum: 15, baseBlock: 0x0f2 },
  DUMMY_WIN_TEMPLATE,
];

const sTextColor = [0, 10, 11];

const sGenderPals = [
  [RGB(13, 22, 26), RGB(5, 13, 20)],
  [RGB(28, 15, 17), RGB(20, 6, 14)],
];

const DARK_TEXT: [number, number] = [RGB(10, 10, 10), RGB(25, 25, 25)];
const LIGHT_TEXT: [number, number] = [RGB(31, 31, 31), RGB(17, 17, 17)];

function gfxData(name: string, size: number, textpals: [number, number]): MailGfxData {
  return { pal: `gFile_graphics_mail_${name}_palette_pal`, tiles: `gFile_graphics_mail_${name}_tiles_sheet`, map: `gFile_graphics_mail_${name}_map_tilemap`, size, textpals };
}

/** sGfxHeaders, by ITEM_TO_MAIL (ITEM_ORANGE_MAIL first) */
const sGfxHeaders: MailGfxData[] = [
  gfxData('orange', 0x2c0, DARK_TEXT),
  gfxData('harbor', 0x2e0, LIGHT_TEXT),
  gfxData('glitter', 0x400, DARK_TEXT),
  gfxData('mech', 0x1e0, LIGHT_TEXT),
  gfxData('wood', 0x2e0, LIGHT_TEXT),
  gfxData('wave', 0x300, DARK_TEXT),
  gfxData('bead', 0x140, LIGHT_TEXT),
  gfxData('shadow', 0x300, LIGHT_TEXT),
  gfxData('tropic', 0x220, DARK_TEXT),
  gfxData('dream', 0x340, DARK_TEXT),
  gfxData('fab', 0x2a0, DARK_TEXT),
  gfxData('retro', 0x520, DARK_TEXT),
];

/** The graphics the mail screen can draw (the menus preload them: menus/host.ts). */
export const MAIL_GFX = sGfxHeaders.flatMap((h) => [h.pal, h.tiles, h.map]);

const line = (numWordsInLine: number): MailEcWordLayout => ({ numWordsInLine, lineXoffset: 0, lineHeight: 16 });

const sLayout_3x3: MailEcWordLayout[] = [line(3), line(3), line(3)];

const layout3x3 = (nameY: number, messageLeft: number): MailAttrStruct => ({ numRows: 3, nameY, nameX: 0, messageTop: 2, messageLeft, linesLayout: sLayout_3x3 });

/** sMessageLayouts_3x3 (mailArrangementType 0, unused in FRLG) */
const sMessageLayouts_3x3: MailAttrStruct[] = [
  layout3x3(0, 4), // ORANGE
  layout3x3(0, 4), // HARBOR
  layout3x3(0, 4), // GLITTER
  layout3x3(0, 4), // MECH
  layout3x3(0, 4), // WOOD
  layout3x3(0, 4), // WAVE
  layout3x3(0, 4), // BEAD
  layout3x3(0, 4), // SHADOW
  layout3x3(0, 4), // TROPIC
  layout3x3(0, 4), // DREAM
  layout3x3(8, 4), // FAB
  layout3x3(0, 0), // RETRO
];

const sLayout_5x2: MailEcWordLayout[] = [line(2), line(2), line(2), line(2), line(1)];

const layout5x2 = (nameY: number, nameX: number): MailAttrStruct => ({ numRows: 5, nameY, nameX, messageTop: 3, messageLeft: 8, linesLayout: sLayout_5x2 });

/** sMessageLayouts_5x2 */
const sMessageLayouts_5x2: MailAttrStruct[] = [
  layout5x2(0, 8), // ORANGE
  layout5x2(3, 14), // HARBOR
  layout5x2(0, 16), // GLITTER
  layout5x2(0, 14), // MECH
  layout5x2(3, 12), // WOOD
  layout5x2(0, 18), // WAVE
  layout5x2(0, 20), // BEAD
  layout5x2(6, 20), // SHADOW
  layout5x2(0, 16), // TROPIC
  layout5x2(0, 14), // DREAM
  layout5x2(8, 16), // FAB
  layout5x2(0, 16), // RETRO
];

/** ITEM_TO_MAIL */
const ITEM_TO_MAIL = (itemId: number) => itemId - K.ITEM_ORANGE_MAIL;

/** IS_ITEM_MAIL */
const IS_ITEM_MAIL = (itemId: number) => itemId >= K.ITEM_ORANGE_MAIL && itemId <= K.ITEM_RETRO_MAIL;

/** The graphics a mail's screen needs: every mail type's, and the icon of each mail species `mails` names. */
export function mailGfxSymbols(mails: readonly Mail[]): string[] {
  const syms = new Set<string>(MAIL_GFX);
  syms.add('gMonIconPalettes');
  for (const mail of mails) {
    if (!IS_ITEM_MAIL(mail.itemId)) continue;
    syms.add(monIconSymbol(MailSpeciesToIconSpecies(state.defines, mail.species)));
  }
  return [...syms];
}

/**
 * ReadMail: show `mail` (its words only if `messageExists`), then `savedCallback`. A mail whose item isn't a mail
 * shows as an Orange Mail without a message.
 */
export function ReadMail(mail: Mail, savedCallback: MainCallback, messageExists: boolean): void {
  const mailType = IS_ITEM_MAIL(mail.itemId) ? ITEM_TO_MAIL(mail.itemId) : ITEM_TO_MAIL(K.ITEM_ORANGE_MAIL);
  if (!IS_ITEM_MAIL(mail.itemId)) messageExists = false;
  const mailArrangementType = 1;
  const messageLayout = mailArrangementType === 1 ? sMessageLayouts_5x2[mailType] : sMessageLayouts_3x3[mailType];
  let monIconType = MAIL_ICON_NONE;
  const { species } = MailSpeciesToSpecies(state.defines, mail.species);
  if (species !== K.SPECIES_NONE && species < K.NUM_SPECIES) {
    if (mailType === ITEM_TO_MAIL(K.ITEM_BEAD_MAIL)) monIconType = MAIL_ICON_BEAD;
    else if (mailType === ITEM_TO_MAIL(K.ITEM_DREAM_MAIL)) monIconType = MAIL_ICON_DREAM;
  }
  sMailViewResources = {
    messageLinesBuffer: Array.from({ length: 8 }, () => [EOS]),
    authorNameBuffer: [EOS],
    savedCallback,
    showMailCallback: () => {},
    mail,
    messageExists,
    nameX: 0,
    mailType,
    monIconType,
    monIconSpriteId: 0,
    unused: 2,
    mailArrangementType,
    messageLayout,
    bg1TilemapBuffer: new Uint16Array(0x400),
    bg2TilemapBuffer: new Uint16Array(0x400),
  };
  gMain.state = 0;
  SetMainCallback2(CB2_InitMailView);
}

function res(): MailViewResources {
  if (!sMailViewResources) throw new Error('[mail] no mail screen (ReadMail)');
  return sMailViewResources;
}

/** DoInitMailView: one step a frame; TRUE once the screen is up and fading in. */
function DoInitMailView(): boolean {
  const r = res();
  const header = sGfxHeaders[r.mailType];
  switch (gMain.state) {
    case 0:
      SetVBlankCallback(null);
      ScanlineEffect_Stop();
      SetGpuReg(REG_OFFSET_DISPCNT, 0);
      SetHelpContext(gPlayerPcMenuManager.notInRoom === false ? K.HELPCONTEXT_BEDROOM_PC_MAILBOX : K.HELPCONTEXT_PLAYERS_PC_MAILBOX);
      break;
    case 1:
      // CpuFill16(0, OAM, OAM_SIZE): ResetSpriteData (case 4) clears the OAM buffer the PPU reads
      break;
    case 2:
      ResetPaletteFade();
      break;
    case 3:
      ResetTasks();
      break;
    case 4:
      ResetSpriteData();
      break;
    case 5:
      FreeAllSpritePalettes();
      ResetTempTileDataBuffers();
      for (const reg of [REG_OFFSET_BG0HOFS, REG_OFFSET_BG0VOFS, REG_OFFSET_BG1HOFS, REG_OFFSET_BG1VOFS, REG_OFFSET_BG2VOFS, REG_OFFSET_BG2HOFS, REG_OFFSET_BG3HOFS, REG_OFFSET_BG3VOFS]) SetGpuReg(reg, 0);
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      break;
    case 6:
      ResetBgsAndClearDma3BusyFlags(false);
      InitBgsFromTemplates(0, sBgTemplates, sBgTemplates.length);
      SetBgTilemapBuffer(1, r.bg1TilemapBuffer);
      SetBgTilemapBuffer(2, r.bg2TilemapBuffer);
      break;
    case 7:
      InitWindows(sWindowTemplates);
      DeactivateAllTextPrinters();
      break;
    case 8:
      DecompressAndCopyTileDataToVram(1, gfx(header.tiles), 0, 0x000, 0);
      break;
    case 9:
      if (FreeTempTileDataBuffersIfPossible()) return false;
      break;
    case 10:
      FillBgTilemapBufferRect_Palette0(0, 0x000, 0, 0, 30, 20);
      FillBgTilemapBufferRect_Palette0(2, 0x001, 0, 0, 30, 20);
      CopyToBgTilemapBuffer(1, gfx16(header.map), 0, 0x000);
      break;
    case 11:
      CopyBgTilemapBufferToVram(0);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(2);
      break;
    case 12: {
      LoadPalette(GetTextWindowPalette(0), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
      gPlttBufferUnfaded[BG_PLTT_ID(15) + 10] = header.textpals[0];
      gPlttBufferFaded[BG_PLTT_ID(15) + 10] = header.textpals[0];
      gPlttBufferUnfaded[BG_PLTT_ID(15) + 11] = header.textpals[1];
      gPlttBufferFaded[BG_PLTT_ID(15) + 11] = header.textpals[1];
      LoadPalette(gfx16(header.pal), BG_PLTT_ID(0), PLTT_SIZE_4BPP);
      const gender = state.playerGender === 'female' ? 1 : 0;
      gPlttBufferUnfaded[BG_PLTT_ID(0) + 10] = sGenderPals[gender][0];
      gPlttBufferFaded[BG_PLTT_ID(0) + 10] = sGenderPals[gender][0];
      gPlttBufferUnfaded[BG_PLTT_ID(0) + 11] = sGenderPals[gender][1];
      gPlttBufferFaded[BG_PLTT_ID(0) + 11] = sGenderPals[gender][1];
      break;
    }
    case 13:
      if (r.messageExists) BufferMailMessage();
      break;
    case 14:
      if (r.messageExists) {
        AddMailMessagePrinters();
        RunTextPrinters();
      }
      break;
    case 15:
      // Overworld_LinkRecvQueueLengthMoreThan2: no link play
      break;
    case 16:
      SetVBlankCallback(VBlankCB_ShowMail);
      gPaletteFade.bufferTransferDisabled = true;
      break;
    case 17: {
      const iconId = MailSpeciesToIconSpecies(state.defines, r.mail.species);
      switch (r.monIconType) {
        case MAIL_ICON_BEAD:
          LoadMonIconPalette(iconId);
          r.monIconSpriteId = CreateMonIcon_HandleDeoxys(iconId, SpriteCallbackDummy, 0x60, 0x80, 0, false);
          break;
        case MAIL_ICON_DREAM:
          LoadMonIconPalette(iconId);
          r.monIconSpriteId = CreateMonIcon_HandleDeoxys(iconId, SpriteCallbackDummy, 0x28, 0x80, 0, false);
          break;
      }
      break;
    }
    case 18:
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
      ShowBg(0);
      ShowBg(1);
      ShowBg(2);
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
      gPaletteFade.bufferTransferDisabled = false;
      r.showMailCallback = ShowMailCB_WaitFadeIn;
      return true;
    default:
      return false;
  }
  gMain.state++;
  return false;
}

/** CB2_InitMailView */
function CB2_InitMailView(): void {
  do {
    if (DoInitMailView()) {
      SetMainCallback2(CB2_RunShowMailCB);
      break;
    }
  } while (MenuHelpers_IsLinkActive());
}

export function StringLength(str: readonly number[]): number {
  const i = str.indexOf(EOS);
  return i < 0 ? str.length : i;
}

/** ConvertInternationalString (string_util.c): a Japanese string wrapped in {JPN} ... {ENG} (EXT_CTRL_CODE_JPN / _ENG). */
export function ConvertInternationalString(s: number[], language: number): number[] {
  if (language !== K.LANGUAGE_JAPANESE) return s;
  const body = StripExtCtrlCodes(s);
  return [0xfc, 21, ...body, 0xfc, 22, EOS];
}

/** StripExtCtrlCodes (string_util.c): the string without its {...} control codes (0xFC and its arguments). */
function StripExtCtrlCodes(s: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length && s[i] !== EOS; i++) {
    if (s[i] === 0xfc) i += GetExtCtrlCodeLength(s[i + 1]);
    else out.push(s[i]);
  }
  return out;
}

/** GetExtCtrlCodeLength (string_util.c): the arguments after 0xFC (the code byte included). */
function GetExtCtrlCodeLength(code: number): number {
  const lengths = [1, 2, 2, 2, 4, 2, 2, 1, 2, 1, 1, 3, 2, 2, 2, 1, 3, 2, 2, 2, 2, 1, 1, 1, 1];
  return code < lengths.length ? lengths[code] : 0;
}

/** BufferMailMessage */
function BufferMailMessage(): void {
  const r = res();
  let j = 0;
  for (let i = 0; i < r.messageLayout.numRows; i++) {
    const n = r.messageLayout.linesLayout[i].numWordsInLine;
    r.messageLinesBuffer[i] = ConvertEasyChatWordsToString(state, r.mail.words.slice(j, j + n), n, 1);
    j += n;
  }
  if (r.mailArrangementType === 0) {
    r.authorNameBuffer = [...r.mail.playerName.slice(0, StringLength(r.mail.playerName)), ...text('gText_From')]; // (sic)
    r.nameX = r.messageLayout.nameX + 0x60 - 8 * StringLength(r.authorNameBuffer);
  } else {
    r.authorNameBuffer = [...r.mail.playerName.slice(0, StringLength(r.mail.playerName)), EOS];
    if (StringLength(r.authorNameBuffer) < 6) r.authorNameBuffer = ConvertInternationalString(r.authorNameBuffer, K.LANGUAGE_JAPANESE);
    r.nameX = r.messageLayout.nameX;
  }
}

/** AddMailMessagePrinters */
function AddMailMessagePrinters(): void {
  const r = res();
  let y = 0;
  PutWindowTilemap(0);
  PutWindowTilemap(1);
  FillWindowPixelBuffer(0, PIXEL_FILL(0));
  FillWindowPixelBuffer(1, PIXEL_FILL(0));
  for (let i = 0; i < r.messageLayout.numRows; i++) {
    const lineBuf = r.messageLinesBuffer[i];
    if (lineBuf[0] !== EOS && lineBuf[0] !== CHAR_SPACE) {
      const l = r.messageLayout.linesLayout[i];
      AddTextPrinterParameterized3(0, FONT_NORMAL_COPY_1, l.lineXoffset + r.messageLayout.messageLeft, y + r.messageLayout.messageTop, sTextColor, 0, lineBuf);
      y += l.lineHeight;
    }
  }
  const from = text('gText_From');
  const width = GetStringWidth(FONT_NORMAL_COPY_1, from, 0);
  AddTextPrinterParameterized3(1, FONT_NORMAL_COPY_1, r.nameX, r.messageLayout.nameY, sTextColor, 0, from);
  AddTextPrinterParameterized3(1, FONT_NORMAL_COPY_1, r.nameX + width, r.messageLayout.nameY, sTextColor, 0, r.authorNameBuffer);
  CopyWindowToVram(0, COPYWIN_FULL);
  CopyWindowToVram(1, COPYWIN_FULL);
}

function VBlankCB_ShowMail(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

/** CB2_RunShowMailCB */
function CB2_RunShowMailCB(): void {
  const r = res();
  if (r.monIconType !== MAIL_ICON_NONE) {
    AnimateSprites();
    BuildOamBuffer();
  }
  r.showMailCallback();
}

function ShowMailCB_WaitFadeIn(): void {
  if (!UpdatePaletteFade()) res().showMailCallback = ShowMailCB_WaitButton;
}

function ShowMailCB_WaitButton(): void {
  if (JOY_NEW(A_BUTTON | B_BUTTON)) {
    BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
    res().showMailCallback = ShowMailCB_Teardown;
  }
}

function ShowMailCB_Teardown(): void {
  if (UpdatePaletteFade()) return;
  const r = res();
  SetMainCallback2(r.savedCallback);
  switch (r.monIconType) {
    case MAIL_ICON_BEAD:
    case MAIL_ICON_DREAM:
      FreeMonIconPalette(MailSpeciesToIconSpecies(state.defines, r.mail.species));
      DestroyMonIcon(gSprites[r.monIconSpriteId]);
      break;
  }
  ResetPaletteFade();
  FreeAllWindowBuffers();
  sMailViewResources = null;
}

/** Dev: the mail screen's state for the e2e tests (undefined when it isn't up). */
export function mailProbe():
  | { initState: number; mailType: number; messageExists: boolean; monIconType: number; iconSpecies?: number; waitingForButton: boolean; lines: number[][]; authorName: number[]; nameX: number }
  | undefined {
  const r = sMailViewResources;
  if (!r) return undefined;
  return {
    initState: gMain.state,
    mailType: r.mailType,
    messageExists: r.messageExists,
    monIconType: r.monIconType,
    iconSpecies: r.monIconType !== MAIL_ICON_NONE ? MailSpeciesToIconSpecies(state.defines, r.mail.species) : undefined,
    waitingForButton: r.showMailCallback === ShowMailCB_WaitButton,
    lines: r.messageLinesBuffer.slice(0, r.messageLayout.numRows).map((l) => l.slice(0, StringLength(l))),
    authorName: r.authorNameBuffer.slice(0, StringLength(r.authorNameBuffer)),
    nameX: r.nameX,
  };
}
