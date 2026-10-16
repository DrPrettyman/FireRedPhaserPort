// task.c: the cooperative task list (priority-ordered linked list over a fixed array).

export type TaskFunc = (taskId: number) => void;

export const NUM_TASKS = 16;
export const NUM_TASK_DATA = 16;
export const TASK_NONE = 0xff;
const HEAD_SENTINEL = 0xfe;
const TAIL_SENTINEL = 0xff;

export const TaskDummy: TaskFunc = () => {};

export class Task {
  func: TaskFunc = TaskDummy;
  isActive = false;
  prev = 0;
  next = 0;
  priority = -1;
  readonly data = new Int16Array(NUM_TASK_DATA);
  /** SetTaskFuncWithFollowupFunc stores a function pointer in data[14..15]; JS keeps it here. */
  followupFunc: TaskFunc = TaskDummy;
  /** StorePointerInVars keeps a pointer in two data slots; JS keeps the object here. */
  ref: unknown = undefined;
}

export const gTasks: Task[] = Array.from({ length: NUM_TASKS }, () => new Task());

export function ResetTasks(): void {
  for (let i = 0; i < NUM_TASKS; i++) {
    const t = gTasks[i];
    t.isActive = false;
    t.func = TaskDummy;
    t.prev = i;
    t.next = i + 1;
    t.priority = -1;
    t.data.fill(0);
  }
  gTasks[0].prev = HEAD_SENTINEL;
  gTasks[NUM_TASKS - 1].next = TAIL_SENTINEL;
}
ResetTasks();

export function CreateTask(func: TaskFunc, priority: number): number {
  for (let i = 0; i < NUM_TASKS; i++) {
    if (!gTasks[i].isActive) {
      gTasks[i].func = func;
      gTasks[i].priority = priority & 0xff;
      insertTask(i);
      gTasks[i].data.fill(0);
      gTasks[i].isActive = true;
      return i;
    }
  }
  return 0;
}

function insertTask(newTaskId: number): void {
  let taskId = findFirstActiveTask();
  const n = gTasks[newTaskId];
  if (taskId === NUM_TASKS) {
    // The new task is the only task.
    n.prev = HEAD_SENTINEL;
    n.next = TAIL_SENTINEL;
    return;
  }
  for (;;) {
    const t = gTasks[taskId];
    if (n.priority < t.priority) {
      // We've found a task with a higher priority value, so we insert the new task before it.
      n.prev = t.prev;
      n.next = taskId;
      if (t.prev !== HEAD_SENTINEL) gTasks[t.prev].next = newTaskId;
      t.prev = newTaskId;
      return;
    }
    if (t.next === TAIL_SENTINEL) {
      // We've reached the end.
      n.prev = taskId;
      n.next = t.next;
      t.next = newTaskId;
      return;
    }
    taskId = t.next;
  }
}

export function DestroyTask(taskId: number): void {
  const t = gTasks[taskId];
  if (!t.isActive) return;
  t.isActive = false;
  if (t.prev === HEAD_SENTINEL) {
    if (t.next !== TAIL_SENTINEL) gTasks[t.next].prev = HEAD_SENTINEL;
  } else if (t.next === TAIL_SENTINEL) {
    gTasks[t.prev].next = TAIL_SENTINEL;
  } else {
    gTasks[t.prev].next = t.next;
    gTasks[t.next].prev = t.prev;
  }
}

export function RunTasks(): void {
  let taskId = findFirstActiveTask();
  if (taskId !== NUM_TASKS) {
    do {
      gTasks[taskId].func(taskId);
      taskId = gTasks[taskId].next;
    } while (taskId !== TAIL_SENTINEL);
  }
}

function findFirstActiveTask(): number {
  let taskId = 0;
  for (; taskId < NUM_TASKS; taskId++) if (gTasks[taskId].isActive && gTasks[taskId].prev === HEAD_SENTINEL) break;
  return taskId;
}

export function SetTaskFuncWithFollowupFunc(taskId: number, func: TaskFunc, followupFunc: TaskFunc): void {
  gTasks[taskId].followupFunc = followupFunc;
  gTasks[taskId].func = func;
}

export function SwitchTaskToFollowupFunc(taskId: number): void {
  gTasks[taskId].func = gTasks[taskId].followupFunc;
}

export function FuncIsActiveTask(func: TaskFunc): boolean {
  for (let i = 0; i < NUM_TASKS; i++) if (gTasks[i].isActive && gTasks[i].func === func) return true;
  return false;
}

export function FindTaskIdByFunc(func: TaskFunc): number {
  for (let i = 0; i < NUM_TASKS; i++) if (gTasks[i].isActive && gTasks[i].func === func) return i;
  return TASK_NONE;
}

export function GetTaskCount(): number {
  return gTasks.filter((t) => t.isActive).length;
}

export function SetWordTaskArg(taskId: number, dataElem: number, value: number): void {
  if (dataElem <= 14) {
    gTasks[taskId].data[dataElem] = value;
    gTasks[taskId].data[dataElem + 1] = value >>> 16;
  }
}

export function GetWordTaskArg(taskId: number, dataElem: number): number {
  if (dataElem <= 14) return ((gTasks[taskId].data[dataElem] & 0xffff) | (gTasks[taskId].data[dataElem + 1] << 16)) >>> 0;
  return 0;
}
