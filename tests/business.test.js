import { describe, it, expect } from 'vitest';

// ── Business logic (pure calculs, extrait de G) ──

const calcFee = (amount) => Math.round(amount * 0.015);
const calcTotal = (amount) => amount + calcFee(amount);
const coffreProgress = (saved, target) => target > 0 ? Math.min(100, Math.round(saved / target * 100)) : 0;
const tontineStatus = (paid, members) => members > 0 ? `${paid}/${members} payé${paid > 1 ? 's' : ''}` : '0/0';

describe('Frais de transfert (1,5%)', () => {
  it('calcule les frais sur 10 000 FCFA', () => expect(calcFee(10000)).toBe(150));
  it('calcule les frais sur 100 000 FCFA', () => expect(calcFee(100000)).toBe(1500));
  it('frais zéro pour montant zéro', () => expect(calcFee(0)).toBe(0));
  it('total = montant + frais', () => expect(calcTotal(10000)).toBe(10150));
  it('arrondit correctement', () => expect(calcFee(1000)).toBe(15));
});

describe('Progression coffre', () => {
  it('50% atteint', () => expect(coffreProgress(50000, 100000)).toBe(50));
  it('objectif atteint (100%)', () => expect(coffreProgress(100000, 100000)).toBe(100));
  it('dépassement plafonné à 100%', () => expect(coffreProgress(120000, 100000)).toBe(100));
  it('coffre vide (0%)', () => expect(coffreProgress(0, 100000)).toBe(0));
  it('objectif zéro — pas de division par zéro', () => expect(coffreProgress(0, 0)).toBe(0));
});

describe('Statut tontine', () => {
  it('3 membres, 1 payé', () => expect(tontineStatus(1, 3)).toBe('1/3 payé'));
  it('5 membres, 5 payés', () => expect(tontineStatus(5, 5)).toBe('5/5 payés'));
  it('aucun membre', () => expect(tontineStatus(0, 0)).toBe('0/0'));
});

describe('Validation solde suffisant', () => {
  const canAfford = (amount, balance) => calcTotal(amount) <= balance;

  it('solde suffisant', () => expect(canAfford(10000, 20000)).toBe(true));
  it('solde juste suffisant', () => expect(canAfford(10000, 10150)).toBe(true));
  it('solde insuffisant', () => expect(canAfford(10000, 10000)).toBe(false));
  it('montant zéro toujours possible', () => expect(canAfford(0, 0)).toBe(true));
});
