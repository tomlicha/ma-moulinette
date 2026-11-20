/**
 * Qui suit qui dans la salle : un coureur en suit au plus un, un coureur peut avoir plusieurs suiveurs. Pure donnée,
 * sans réseau ni règle d'accès : `Room` décide si un suivi est permis, ce registre ne fait que s'en souvenir.
 */
export class FollowBook {
  private readonly leaderOf = new Map<number, number>();

  /** `follower` suit désormais `leader`. Renvoie celui qu'il suivait avant, s'il y en a un. */
  follow(follower: number, leader: number): number | undefined {
    const before = this.leaderOf.get(follower);
    this.leaderOf.set(follower, leader);
    return before;
  }

  /** `follower` ne suit plus personne. Renvoie celui qu'il suivait. */
  unfollow(follower: number): number | undefined {
    const before = this.leaderOf.get(follower);
    this.leaderOf.delete(follower);
    return before;
  }

  leader(follower: number): number | undefined {
    return this.leaderOf.get(follower);
  }

  followersOf(leader: number): number[] {
    const out: number[] = [];
    for (const [f, l] of this.leaderOf) if (l === leader) out.push(f);
    return out;
  }

  /** Un coureur part : il ne suit plus personne et plus personne ne le suit. Renvoie ce qu'il faut annoncer. */
  drop(slot: number): { wasFollowing?: number; followers: number[] } {
    const followers = this.followersOf(slot);
    for (const f of followers) this.leaderOf.delete(f);
    const wasFollowing = this.unfollow(slot);
    return wasFollowing === undefined ? { followers } : { wasFollowing, followers };
  }
}
