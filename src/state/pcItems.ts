// item.c's item PC functions on gSaveBlock1Ptr->pcItems (GameState.pcItems), and player_pc.c's
// NewGameInitPCItems. PC item quantities aren't encrypted on the GBA either (GetPcItemQuantity XORs with 0).

import type { ItemSlot } from './Bag';

/** item.c compares stack sizes against a literal 999. */
const MAX_PC_ITEM_CAPACITY = 999;

/** ClearPCItemSlots */
export function ClearPCItemSlots(pcItems: ItemSlot[], ITEM_NONE: number): void {
  for (const slot of pcItems) {
    slot.itemId = ITEM_NONE;
    slot.quantity = 0;
  }
}

/** PCItemsGetFirstEmptySlot: -1 if every slot is used. */
export function PCItemsGetFirstEmptySlot(pcItems: ItemSlot[], ITEM_NONE: number): number {
  return pcItems.findIndex((s) => s.itemId === ITEM_NONE);
}

/** CountItemsInPC */
export function CountItemsInPC(pcItems: ItemSlot[], ITEM_NONE: number): number {
  return pcItems.filter((s) => s.itemId !== ITEM_NONE).length;
}

/** CheckPCHasItem */
export function CheckPCHasItem(pcItems: ItemSlot[], itemId: number, count: number): boolean {
  return pcItems.some((s) => s.itemId === itemId && s.quantity >= count);
}

/** AddPCItem: onto the item's stack (up to 999), else into the first empty slot. */
export function AddPCItem(pcItems: ItemSlot[], ITEM_NONE: number, itemId: number, count: number): boolean {
  for (const slot of pcItems) {
    if (slot.itemId === itemId) {
      if (slot.quantity + count > MAX_PC_ITEM_CAPACITY) return false;
      slot.quantity += count;
      return true;
    }
  }
  const idx = PCItemsGetFirstEmptySlot(pcItems, ITEM_NONE);
  if (idx === -1) return false;
  pcItems[idx].itemId = itemId;
  pcItems[idx].quantity = count;
  return true;
}

/** RemovePCItem: from the item's first stack; an emptied stack's slot becomes ITEM_NONE. */
export function RemovePCItem(pcItems: ItemSlot[], ITEM_NONE: number, itemId: number, count: number): void {
  if (itemId === ITEM_NONE) return;
  const slot = pcItems.find((s) => s.itemId === itemId);
  if (slot) {
    slot.quantity = (slot.quantity - count) & 0xffff;
    if (slot.quantity === 0) slot.itemId = ITEM_NONE;
  }
}

/** ItemPcCompaction: the C's bubble that moves empty slots to the end. */
export function ItemPcCompaction(pcItems: ItemSlot[], ITEM_NONE: number): void {
  for (let i = 0; i < pcItems.length - 1; i++) {
    for (let j = i + 1; j < pcItems.length; j++) {
      if (pcItems[i].itemId === ITEM_NONE) {
        const tmp = { ...pcItems[i] };
        Object.assign(pcItems[i], pcItems[j]);
        Object.assign(pcItems[j], tmp);
      }
    }
  }
}

/** NewGameInitPCItems (player_pc.c): gNewGamePCItems, a Potion. */
export function NewGameInitPCItems(pcItems: ItemSlot[], ITEM_NONE: number, ITEM_POTION: number): void {
  ClearPCItemSlots(pcItems, ITEM_NONE);
  const gNewGamePCItems: [number, number][] = [
    [ITEM_POTION, 1],
    [ITEM_NONE, 0],
  ];
  for (let i = 0; gNewGamePCItems[i][0] && gNewGamePCItems[i][1] && AddPCItem(pcItems, ITEM_NONE, gNewGamePCItems[i][0], gNewGamePCItems[i][1]); i++);
}
