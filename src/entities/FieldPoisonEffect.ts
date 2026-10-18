import { K } from '../battle/constants';
import { PlaySE } from '../gba/sound';

/**
 * fldeff_poison.c's Task_FieldPoisonEffect: the map BGs' mosaic grows by 1 each frame to 5 and shrinks
 * back to 0 (REVISION 0; later revisions grow by 2). Constructing it is FldEffPoison_Start (SE_FIELD_POISON).
 */
export class FieldPoisonEffect {
  private state = 0;
  private size = 0;

  /** FldEffPoison_IsActive */
  active = true;

  constructor(private setMosaic: (value: number) => void) {
    PlaySE(K.SE_FIELD_POISON); // FldEffPoison_Start
  }

  tick(): void {
    if (!this.active) return;
    switch (this.state) {
      case 0:
        this.size += 1;
        if (this.size > 4) this.state++;
        break;
      case 1:
        this.size -= 1;
        if (this.size === 0) this.state++;
        break;
      case 2:
        this.active = false; // DestroyTask
        return;
    }
    this.setMosaic(((this.size << 4) | this.size) & 0xff);
  }
}
