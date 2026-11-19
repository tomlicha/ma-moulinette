import { describe, expect, it, vi } from 'vitest';
import type { GpuLoss, RideView } from '../render/ride-view';
import { Background } from '../shared/util/background';
import { RideViewLoader, type ViewBuildOptions } from './ride-view-loader';

const loss: GpuLoss = { api: 'WebGL', message: 'perdu' };

class GpuLostError extends Error {
  constructor(readonly loss: GpuLoss) {
    super('GPU perdu');
    this.name = 'GpuLostError';
  }
}

function fakeView() {
  return { dispose: vi.fn(), onLost: undefined as ((l: GpuLoss) => void) | undefined } as unknown as RideView & {
    dispose: ReturnType<typeof vi.fn>;
  };
}

function setup(over: { create?: (o: ViewBuildOptions) => Promise<RideView>; rideScreenOpen?: boolean; maxLosses?: number } = {}) {
  const views: RideView[] = [];
  const options: ViewBuildOptions[] = [];
  const backgrounds: Background[] = [];
  const create =
    over.create ??
    (async () => {
      const v = fakeView();
      views.push(v);
      return v;
    });
  const loader = new RideViewLoader({
    create: async (o) => {
      options.push(o);
      return create(o);
    },
    rideScreenOpen: () => over.rideScreenOpen ?? false,
    ...(over.maxLosses !== undefined ? { maxLosses: over.maxLosses } : {}),
    makeBackground: () => {
      const b = new Background();
      backgrounds.push(b);
      return b;
    },
  });
  const events: string[] = [];
  for (const e of ['progress', 'ready', 'lost', 'retrying', 'unavailable'] as const) loader.on(e, (() => events.push(e)) as never);
  /** Laisse aboutir les promesses en cours. */
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { loader, views, options, backgrounds, events, settle };
}

describe('RideViewLoader', () => {
  it('n\'a pas de vue avant la construction', () => {
    const { loader } = setup();
    expect(loader.view).toBeUndefined();
    expect(loader.losses).toBe(0);
  });

  it('construit la vue, la garde et la publie', async () => {
    const { loader, views, events, settle } = setup();
    loader.start();
    await settle();
    expect(loader.view).toBe(views[0]);
    expect(events).toEqual(['ready']);
  });

  it('ne lance qu\'une construction, même si on le demande plusieurs fois', async () => {
    const { loader, options, settle } = setup();
    loader.start();
    loader.start();
    loader.hurry();
    await settle();
    loader.start();
    expect(options).toHaveLength(1);
  });

  it('transmet la progression', async () => {
    const seen: [number, string][] = [];
    const { loader, settle } = setup({
      create: async (o) => {
        o.onProgress(0.5, 'terrain');
        return fakeView();
      },
    });
    loader.on('progress', (d, s) => seen.push([d, s]));
    loader.start();
    await settle();
    expect(seen).toEqual([[0.5, 'terrain']]);
  });

  it('commence par WebGPU, et passe en WebGL2 à partir de la deuxième perte', async () => {
    const { loader, options, views, settle } = setup();
    loader.start();
    await settle();
    expect(options[0]!.forceWebGL).toBe(false);
    views[0]!.onLost!(loss);
    await settle();
    expect(options[1]!.forceWebGL).toBe(false); // une perte
    views[1]!.onLost!(loss);
    await settle();
    expect(options[2]!.forceWebGL).toBe(true); // deux pertes
  });

  describe('perte du GPU', () => {
    it('libère la vue perdue, prévient pour changer de canevas, puis reconstruit', async () => {
      const { loader, views, events, settle } = setup();
      loader.start();
      await settle();
      events.length = 0;
      views[0]!.onLost!(loss);
      expect(loader.losses).toBe(1);
      expect((views[0] as unknown as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled();
      expect(events.slice(0, 2)).toEqual(['lost', 'retrying']);
      await settle();
      expect(events).toEqual(['lost', 'retrying', 'ready']);
      expect(loader.view).toBe(views[1]);
    });

    it('annonce la perte, le numéro de reprise et le maximum', async () => {
      const { loader, views, settle } = setup();
      const seen: [GpuLoss, number, number][] = [];
      loader.on('lost', (l, a, m) => seen.push([l, a, m]));
      loader.start();
      await settle();
      views[0]!.onLost!(loss);
      expect(seen).toEqual([[loss, 1, 3]]);
    });

    it('une perte pendant la construction mène à la même reprise', async () => {
      let first = true;
      const { loader, events, views, settle } = setup({
        create: async () => {
          if (first) {
            first = false;
            throw new GpuLostError(loss);
          }
          const v = fakeView();
          views.push(v);
          return v;
        },
      });
      loader.start();
      await settle();
      await settle();
      expect(events).toEqual(['lost', 'retrying', 'ready']);
      expect(loader.losses).toBe(1);
    });

    it('renonce après trop de pertes', async () => {
      const { loader, views, events, settle } = setup({ maxLosses: 2 });
      const errors: unknown[] = [];
      loader.on('unavailable', (e) => errors.push(e));
      loader.start();
      await settle();
      views[0]!.onLost!(loss);
      await settle();
      views[1]!.onLost!(loss);
      await settle();
      views[2]!.onLost!(loss); // la troisième dépasse le maximum
      await settle();
      expect(events.at(-1)).toBe('unavailable');
      expect(events.filter((e) => e === 'ready')).toHaveLength(3);
      expect((errors[0] as Error).message).toBe('GPU perdu trop souvent');
      expect(loader.view).toBeUndefined();
    });

    it('une reprise ne recrée pas de vue quand on y a renoncé', async () => {
      const { loader, views, options, settle } = setup({ maxLosses: 0 });
      loader.start();
      await settle();
      views[0]!.onLost!(loss);
      await settle();
      expect(options).toHaveLength(1);
    });
  });

  it('une erreur de construction autre que la perte du GPU rend la vue indisponible', async () => {
    const { loader, events, settle } = setup({ create: async () => Promise.reject(new Error('WebGPU absent')) });
    const errors: unknown[] = [];
    loader.on('unavailable', (e) => errors.push(e));
    loader.start();
    await settle();
    expect(events).toEqual(['unavailable']);
    expect((errors[0] as Error).message).toBe('WebGPU absent');
    expect(loader.losses).toBe(0);
  });

  describe('priorité de la construction', () => {
    it('hurry presse la construction et la lance si elle ne l\'était pas', async () => {
      const { loader, backgrounds, options, settle } = setup();
      loader.hurry();
      await settle();
      expect(backgrounds[0]!.hurried).toBe(true);
      expect(options[0]!.background).toBe(backgrounds[0]);
    });

    it('calm la remet derrière l\'interface', () => {
      const { loader, backgrounds } = setup();
      loader.hurry();
      loader.calm();
      expect(backgrounds[0]!.hurried).toBe(false);
    });

    it('après une perte, la nouvelle construction se presse si la Sortie est ouverte', async () => {
      const open = setup({ rideScreenOpen: true });
      open.loader.start();
      await open.settle();
      open.views[0]!.onLost!(loss);
      await open.settle();
      expect(open.backgrounds).toHaveLength(2);
      expect(open.backgrounds[1]!.hurried).toBe(true);

      const closed = setup({ rideScreenOpen: false });
      closed.loader.start();
      await closed.settle();
      closed.views[0]!.onLost!(loss);
      await closed.settle();
      expect(closed.backgrounds[1]!.hurried).toBe(false);
    });
  });
});
