// Fixture for nest.json: a decorated class with an injected constructor parameter, the shape
// Nest relies on (experimentalDecorators + emitDecoratorMetadata). No Nest dependency needed.
function Injectable(): ClassDecorator {
  return () => undefined;
}

export class PracticeSettings {
  readonly timeZone: string = 'Asia/Riyadh';
}

@Injectable()
export class SlotService {
  constructor(private readonly settings: PracticeSettings) {}

  timeZone(): string {
    return this.settings.timeZone;
  }
}
