import { describe, it, expect } from 'vitest';
import { SortedInsertionBuffer } from '../../src/lib/utils/sorted-insertion-buffer';

describe('SortedInsertionBuffer', () => {
  it('starts empty', () => {
    const buf = new SortedInsertionBuffer();
    expect(buf.sorted).toEqual([]);
    expect(buf.length).toBe(0);
  });

  it('maintains ascending order after arbitrary insertions', () => {
    const buf = new SortedInsertionBuffer();
    buf.insert(50);
    buf.insert(10);
    buf.insert(30);
    buf.insert(20);
    buf.insert(40);
    expect(buf.sorted).toEqual([10, 20, 30, 40, 50]);
  });

  it('handles duplicate values', () => {
    const buf = new SortedInsertionBuffer();
    buf.insert(5);
    buf.insert(5);
    buf.insert(5);
    expect(buf.sorted).toEqual([5, 5, 5]);
    expect(buf.length).toBe(3);
  });

  it('inserts at head correctly', () => {
    const buf = new SortedInsertionBuffer();
    buf.insert(10);
    buf.insert(20);
    buf.insert(5);
    expect(buf.sorted[0]).toBe(5);
  });

  it('handles already-sorted insertion efficiently', () => {
    const buf = new SortedInsertionBuffer();
    buf.insert(1);
    buf.insert(2);
    buf.insert(3);
    buf.insert(4);
    expect(buf.sorted).toEqual([1, 2, 3, 4]);
  });

  it('handles reverse-sorted insertion', () => {
    const buf = new SortedInsertionBuffer();
    buf.insert(4);
    buf.insert(3);
    buf.insert(2);
    buf.insert(1);
    expect(buf.sorted).toEqual([1, 2, 3, 4]);
  });

  it('sorted getter returns the same array reference on repeated calls', () => {
    const buf = new SortedInsertionBuffer();
    buf.insert(1);
    const ref1 = buf.sorted;
    const ref2 = buf.sorted;
    expect(ref1).toBe(ref2);
  });

  it('length grows without bound', () => {
    const buf = new SortedInsertionBuffer();
    for (let i = 0; i < 1000; i++) buf.insert(Math.random() * 1000);
    expect(buf.length).toBe(1000);
  });

  it('sorted array is always ascending after bulk random inserts', () => {
    const buf = new SortedInsertionBuffer();
    for (let i = 0; i < 100; i++) buf.insert(Math.floor(Math.random() * 200));
    const arr = buf.sorted;
    for (let i = 1; i < arr.length; i++) {
      expect(arr[i]).toBeGreaterThanOrEqual(arr[i - 1]);
    }
  });

  it('reset clears all values and resets length', () => {
    const buf = new SortedInsertionBuffer();
    buf.insert(1);
    buf.insert(2);
    buf.reset();
    expect(buf.sorted).toEqual([]);
    expect(buf.length).toBe(0);
  });

  it('loadFrom sorts the provided values once', () => {
    const buf = new SortedInsertionBuffer();
    buf.loadFrom([30, 10, 20, 50, 40]);
    expect(buf.sorted).toEqual([10, 20, 30, 40, 50]);
    expect(buf.length).toBe(5);
  });

  it('loadFrom replaces any existing values', () => {
    const buf = new SortedInsertionBuffer();
    buf.insert(999);
    buf.loadFrom([3, 1, 2]);
    expect(buf.sorted).toEqual([1, 2, 3]);
    expect(buf.length).toBe(3);
  });

  it('loadFrom with already-sorted input stays sorted', () => {
    const buf = new SortedInsertionBuffer();
    buf.loadFrom([1, 2, 3, 4, 5]);
    expect(buf.sorted).toEqual([1, 2, 3, 4, 5]);
  });
});
