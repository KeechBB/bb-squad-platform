import { findBlackberryClanIds } from "@/lib/reserve";
import { removeDepartedBlackberryMembers } from "@/lib/bbStackAuto";

export type BbClanFromTrainResult = {
  ok: boolean;
  clanId: string | null;
  fromSessions: number;
  fromLadder: number;
  candidates: number;
  alreadyInBb: number;
  inOtherClan: number;
  added: number;
  message: string;
};

/**
 * Раньше докидывал TR1/TR2 / train ladder в ClanMember BB.
 * Отключено — в клан только заявка / инвайт.
 */
export async function addTrainPlayersToBlackberryClan(): Promise<BbClanFromTrainResult> {
  const clanIds = await findBlackberryClanIds();
  if (clanIds.length === 0) {
    return {
      ok: false,
      clanId: null,
      fromSessions: 0,
      fromLadder: 0,
      candidates: 0,
      alreadyInBb: 0,
      inOtherClan: 0,
      added: 0,
      message: "Клан BlackBerry не найден",
    };
  }
  const clanId = clanIds[0];
  await removeDepartedBlackberryMembers(clanId);
  return {
    ok: true,
    clanId,
    fromSessions: 0,
    fromLadder: 0,
    candidates: 0,
    alreadyInBb: 0,
    inOtherClan: 0,
    added: 0,
    message: "Автодобавление в клан отключено — только заявка / инвайт",
  };
}
