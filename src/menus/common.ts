// What party_menu.c / item_menu.c / item_use.c reach for in other files: string buffers and
// string_util.c (gStringVar1-4, StringExpandPlaceholders, ConvertIntToDecimalStringN), item.c's
// ItemId_Get* accessors and bag pockets, mail_data.c's ItemIsMail, and gPlayerParty.

import { K } from '../battle/constants';
import { charmap, gItems, pokemon, state, textStrings } from '../battle/env';
import { ConvertIntToDecimalStringN as convertDigits } from '../battle/stringUtil';
import type { ItemSlot } from '../state/Bag';
import type { Pokemon } from '../pokemon/Pokemon';
import { expandPlaceholders } from '../text/placeholders';

export const EOS = 0xff;

// ------------------------------------------------------------------ strings

const encodedText = new Map<string, number[]>();

/** A C string from src/strings.c (gText_*, gOtherText_*, ...), encoded with EOS. */
export function text(symbol: string): number[] {
  let s = encodedText.get(symbol);
  if (!s) {
    const raw = textStrings[symbol];
    if (raw === undefined) throw new Error(`[menus] unknown string ${symbol}`);
    s = charmap.encode(raw);
    encodedText.set(symbol, s);
  }
  return s;
}

/** Raw decomp text (item descriptions, names) encoded with EOS. */
export function encodeRaw(raw: string): number[] {
  return charmap.encode(raw);
}

/** gStringVar1..3 (STR_VAR_1..3), stored without EOS like the script engine keeps them. */
export const gStringVar1 = {
  get: () => state.stringVars[0],
  set: (v: number[]) => (state.stringVars[0] = strBody(v)),
};
export const gStringVar2 = {
  get: () => state.stringVars[1],
  set: (v: number[]) => (state.stringVars[1] = strBody(v)),
};
export const gStringVar3 = {
  get: () => state.stringVars[2],
  set: (v: number[]) => (state.stringVars[2] = strBody(v)),
};

/** gStringVar4 (with EOS). */
export let gStringVar4: number[] = [EOS];
export function setStringVar4(v: number[]): void {
  gStringVar4 = v;
}

/** The bytes before EOS. */
export function strBody(s: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length && s[i] !== EOS; i++) out.push(s[i]);
  return out;
}

/** StringExpandPlaceholders(dest, src): returns the expanded string (with EOS). */
export function StringExpandPlaceholders(src: number[]): number[] {
  const out = expandPlaceholders(src, charmap, state);
  if (out[out.length - 1] !== EOS) out.push(EOS);
  return out;
}

/** StringExpandPlaceholders(gStringVar4, src) */
export function ExpandToStringVar4(src: number[]): number[] {
  gStringVar4 = StringExpandPlaceholders(src);
  return gStringVar4;
}

export const STR_CONV_MODE_LEFT_ALIGN = 0;
export const STR_CONV_MODE_RIGHT_ALIGN = 1;
export const STR_CONV_MODE_LEADING_ZEROS = 2;

/** ConvertIntToDecimalStringN: the digits plus EOS. */
export function ConvertIntToDecimalStringN(value: number, mode: number, n: number): number[] {
  return [...convertDigits(value, mode, n), EOS];
}

/** StringCopy(dest, a) + StringAppend(dest, b) */
export function concat(...parts: number[][]): number[] {
  return [...parts.flatMap((p) => strBody(p)), EOS];
}

// ------------------------------------------------------------------ item.c

const item = (itemId: number) => gItems[itemId] ?? gItems[0];

export function ItemId_GetName(itemId: number): number[] {
  return encodeRaw(item(itemId).name);
}

/** CopyItemName */
export function CopyItemName(itemId: number): number[] {
  return ItemId_GetName(itemId);
}

export function ItemId_GetPrice(itemId: number): number {
  return item(itemId).price;
}

export function ItemId_GetHoldEffectParam(itemId: number): number {
  return item(itemId).holdEffectParam;
}

export function ItemId_GetDescription(itemId: number): number[] {
  return encodeRaw(item(itemId).description);
}

export function ItemId_GetImportance(itemId: number): number {
  return item(itemId).importance;
}

export function ItemId_GetPocket(itemId: number): number {
  return item(itemId).pocket;
}

/** GetPocketByItemId */
export const GetPocketByItemId = ItemId_GetPocket;

/** ItemId_GetType: ITEM_TYPE_* */
export function ItemId_GetType(itemId: number): number {
  const t = item(itemId).type as unknown;
  return typeof t === 'number' ? t : K[t as string];
}

/** ItemId_GetFieldFunc: the C function's name (dispatched by item_use). */
export function ItemId_GetFieldFunc(itemId: number): string {
  return item(itemId).fieldUseFunc;
}

export function ItemId_GetBattleUsage(itemId: number): number {
  return item(itemId).battleUsage;
}

/** ItemId_GetBattleFunc: the C function's name. */
export function ItemId_GetBattleFunc(itemId: number): string {
  return item(itemId).battleUseFunc;
}

/** ItemId_GetSecondaryId: items.json keeps a named constant as its name (the rods' OLD_ROD / GOOD_ROD / SUPER_ROD). */
export function ItemId_GetSecondaryId(itemId: number): number {
  const id = item(itemId).secondaryId;
  return typeof id === 'string' ? K[id] : id;
}

/** ItemIsMail (mail_data.c) */
export function ItemIsMail(itemId: number): boolean {
  return itemId >= K.ITEM_ORANGE_MAIL && itemId <= K.ITEM_RETRO_MAIL;
}

/** gBagPockets[pocket].itemSlots (pocket is 0-based, like gBagMenuState.pocket) */
export function bagPocket(pocket: number): ItemSlot[] {
  return state.bag.pockets[pocket];
}

export function BagGetItemIdByPocketPosition(pocketId: number, slotId: number): number {
  return state.bag.pockets[pocketId - 1][slotId]?.itemId ?? K.ITEM_NONE;
}

export function BagGetQuantityByPocketPosition(pocketId: number, slotId: number): number {
  return state.bag.pockets[pocketId - 1][slotId]?.quantity ?? 0;
}

/** BagGetQuantityByItemId: the quantity of the item's first stack in its pocket. */
export function BagGetQuantityByItemId(itemId: number): number {
  const slot = state.bag.pockets[ItemId_GetPocket(itemId) - 1]?.find((s) => s.itemId === itemId);
  return slot?.quantity ?? 0;
}

/** BagPocketCompaction: move empty slots to the end (a bubble of SwapItemSlots). */
export function BagPocketCompaction(slots: ItemSlot[], capacity: number): void {
  for (let i = 0; i < capacity - 1; i++) {
    for (let j = i + 1; j < capacity; j++) {
      if (slots[i].quantity === 0) [slots[i], slots[j]] = [slots[j], slots[i]];
    }
  }
}

export const AddBagItem = (itemId: number, count: number): boolean => state.bag.add(itemId, count);
export const RemoveBagItem = (itemId: number, count: number): boolean => state.bag.remove(itemId, count);
export const CheckBagHasItem = (itemId: number, count: number): boolean => state.bag.has(itemId, count);

// ------------------------------------------------------------------ gPlayerParty

/** gPlayerParty[slot] (undefined = an empty slot, SPECIES_NONE). */
export function partyMon(slot: number): Pokemon | undefined {
  return state.party[slot];
}

/** GetMonData(mon, MON_DATA_SPECIES) for a possibly empty slot */
export function partySpecies(slot: number): number {
  return state.party[slot]?.species ?? K.SPECIES_NONE;
}

/** CalculatePlayerPartyCount */
export function CalculatePlayerPartyCount(): number {
  return state.party.length;
}

/** MON_DATA_SPECIES_OR_EGG */
export function speciesOrEgg(mon: Pokemon): number {
  return mon.isEgg ? K.SPECIES_EGG : mon.species;
}

/** GetMonNickname: the nickname as StringGet_Nickname leaves it (at most POKEMON_NAME_LENGTH chars + EOS). */
export function GetMonNickname(mon: Pokemon): number[] {
  return [...strBody(mon.nickname).slice(0, K.POKEMON_NAME_LENGTH), EOS];
}

/** gSpeciesNames[species] */
export function speciesName(species: number): number[] {
  return [...pokemon.speciesName(species), EOS];
}

/** StringCompare == 0 */
export function stringsEqual(a: number[], b: number[]): boolean {
  const x = strBody(a);
  const y = strBody(b);
  return x.length === y.length && x.every((c, i) => c === y[i]);
}
