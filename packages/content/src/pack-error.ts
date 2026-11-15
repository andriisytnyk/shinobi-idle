/**
 * An error caused by one pack. `pack` is the id of the pack at fault, as data: a host that wants to
 * leave the pack out reads this field and never the text of the message.
 */
export class PackError extends Error {
  readonly pack: string;
  constructor(pack: string, message: string) {
    super(message);
    this.name = 'PackError';
    this.pack = pack;
  }
}
