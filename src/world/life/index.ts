// Belebte Welt: bündelt Tiere, Verkehr, Dörfer und Straßenrand.
import * as THREE from 'three';
import { type LifeCtx, Land, Roads, Houses } from './common';
import { Animals } from './animals';
import { Traffic } from './traffic';
import { Village } from './village';
import { Roadside } from './roadside';

export type { LifeCtx };
export class Life {
  readonly group = new THREE.Group();
  readonly traffic: Traffic;
  private animals: Animals; private village: Village; private roadside: Roadside;
  private timer = 0;
  constructor(ctx: LifeCtx) {
    const land = new Land(ctx), roads = new Roads(ctx), houses = ctx.houses ? new Houses(ctx.houses.houses) : null;
    this.animals = new Animals(ctx, land, roads, houses);
    this.traffic = new Traffic(ctx, land, roads, houses);
    this.village = new Village(ctx, land, roads, houses);
    this.roadside = new Roadside(ctx, land, roads, houses);
    this.group.add(this.animals.group, this.traffic.group, this.village.group, this.roadside.group);
  }
  update(dt: number, cam: THREE.Vector3, rider: THREE.Vector3, riderD: number, speed: number, riderLat: number, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = 0.4; this.roadside.update(cam); this.traffic.parked.update(cam); }
    this.village.update(dt, cam, renderer, camera);
    this.animals.update(dt, cam, rider);
    this.traffic.update(dt, riderD, speed, riderLat);
  }
}
