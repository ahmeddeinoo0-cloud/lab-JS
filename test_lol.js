import {
    delay, smartFetch, parallelLimit, createCachedFunction, createDebouncedSearch, fetchFromFastest
} from './lab.js';

// Вспомогательные функции для тестирования
class AssertionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AssertionError';
    }
}

function assert(condition, message = 'Assertion failed') {
    if (!condition) {
        throw new AssertionError(message);
    }
}

function expect(value) {
    return {
        toBe(expected) {
            assert(value === expected, `Expected ${expected}, got ${value}`);
        },
        toEqual(expected) {
            assert(JSON.stringify(value) === JSON.stringify(expected),
                `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
        },
        toBeGreaterThan(expected) {
            assert(value > expected, `Expected greater than ${expected}, got ${value}`);
        },
        toBeGreaterThanOrEqual(expected) {
            assert(value >= expected, `Expected greater than or equal to ${expected}, got ${value}`);
        },
        toBeLessThan(expected) {
            assert(value < expected, `Expected less than ${expected}, got ${value}`);
        },
        toBeDefined() {
            assert(value !== undefined, 'Expected defined value');
        },
        toHaveLength(expected) {
            assert(value.length === expected, `Expected length ${expected}, got ${value.length}`);
        },
        toThrow(expectedMessage) {
            try {
                if (typeof value === 'function') {
                    value();
                } else {
                    value.then ? value.then(() => { }, () => { }) : value;
                }
                throw new AssertionError('Expected function to throw');
            } catch (error) {
                if (expectedMessage && !error.message.includes(expectedMessage)) {
                    throw new AssertionError(`Expected error message to contain "${expectedMessage}", got "${error.message}"`);
                }
            }
        },
        rejects: {
            async toThrow(expectedMessage) {
                try {
                    await value;
                    throw new AssertionError('Expected promise to reject');
                } catch (error) {
                    if (expectedMessage && !error.message.includes(expectedMessage)) {
                        throw new AssertionError(`Expected error message to contain "${expectedMessage}", got "${error.message}"`);
                    }
                }
            }
        },
        toBeInstanceOf(expected) {
            assert(value instanceof expected, `Expected instance of ${expected.name}`);
        }
    };
}

async function describe(name, fn) {
    console.log(`\n${name}`);
    try {
        await fn();
        console.log('✓ Все тесты пройдены');
    } catch (error) {
        console.error(`✗ Ошибка: ${error.message}`);
        if (error.stack) {
            console.error(error.stack.split('\n')[1]);
        }
    }
}

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (error) {
        console.error(`  ✗ ${name}: ${error.message}`);
        throw error;
    }
}

// ============================================================================
//                     ЗАДАНИЕ 1: SMART API FETCHER
// ============================================================================

await describe('Задание 1: Smart API Fetcher', async () => {

    await test('должен выполнить успешный запрос с первой попытки', async () => {
        const fetchFn = async () => ({ message: 'success' });
        const result = await smartFetch(fetchFn);

        expect(result.data.message).toBe('success');
        expect(result.attempts).toBe(1);
        expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    await test('должен повторить запрос при ошибке и вернуть результат', async () => {
        let attempts = 0;
        const fetchFn = async () => {
            attempts++;
            if (attempts < 3) {
                throw new Error('fail');
            }
            return { message: 'success after retries' };
        };

        const result = await smartFetch(fetchFn);
        expect(result.data.message).toBe('success after retries');
        expect(result.attempts).toBe(3);
    });

    await test('должен выбросить ошибку после исчерпания всех попыток', async () => {
        const fetchFn = async () => {
            throw new Error('always fails');
        };

        await expect(
            smartFetch(fetchFn, { retries: 2 })
        ).rejects.toThrow('always fails');
    });

    await test('должен применить таймаут и выбросить ошибку', async () => {
        const fetchFn = async () => {
            await delay(200);
            return { message: 'too slow' };
        };

        await expect(
            smartFetch(fetchFn, { timeout: 100, retries: 1 })
        ).rejects.toThrow('Timeout');
    });

    await test('должен использовать дефолтные значения опций', async () => {
        const fetchFn = async () => 'ok';
        const result = await smartFetch(fetchFn);

        expect(result.data).toBe('ok');
        expect(result.attempts).toBe(1);
    });

    await test('должен корректно измерять время выполнения', async () => {
        const fetchFn = async () => {
            await delay(50);
            return 'data';
        };

        const result = await smartFetch(fetchFn);
        expect(result.duration).toBeGreaterThanOrEqual(50);
        expect(result.duration).toBeLessThan(100);
    });

    await test('должен успешно выполниться со второй попытки', async () => {
        let attempts = 0;
        const fetchFn = async () => {
            attempts++;
            if (attempts < 2) throw new Error('fail');
            return 'success';
        };

        const result = await smartFetch(fetchFn, { retries: 3 });
        expect(result.attempts).toBe(2);
        expect(result.data).toBe('success');
    });

    await test('должен применять retryDelay между попытками', async () => {
        let attempts = 0;
        const timestamps = [];

        const fetchFn = async () => {
            timestamps.push(Date.now());
            attempts++;
            if (attempts < 3) throw new Error('fail');
            return 'ok';
        };

        await smartFetch(fetchFn, { retries: 3, retryDelay: 50 });

        expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(50);
    });

    await test('должен учитывать таймаут при retry', async () => {
        let attempts = 0;
        const fetchFn = async () => {
            attempts++;
            await delay(150);
            return 'too slow';
        };

        await expect(
            smartFetch(fetchFn, { timeout: 100, retries: 2, retryDelay: 10 })
        ).rejects.toThrow();

        expect(attempts).toBeGreaterThan(0);
    });
});

// ============================================================================
//              ЗАДАНИЕ 2: ПАРАЛЛЕЛЬНАЯ ЗАГРУЗКА С ЛИМИТОМ
// ============================================================================

await describe('Задание 2: Параллельная загрузка с лимитом', async () => {

    await test('должен выполнить все задачи и вернуть результаты', async () => {
        const tasks = [
            async () => 1,
            async () => 2,
            async () => 3
        ];

        const results = await parallelLimit(tasks, 2);
        expect(results).toEqual([1, 2, 3]);
    });

    await test('должен ограничить количество одновременных задач', async () => {
        let concurrent = 0;
        let maxConcurrent = 0;

        const createTask = (value) => async () => {
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            await delay(50);
            concurrent--;
            return value;
        };

        const tasks = Array(10).fill(0).map((_, i) => createTask(i));
        await parallelLimit(tasks, 3);

        expect(maxConcurrent).toBe(3);
    });

    await test('должен сохранить порядок результатов', async () => {
        const tasks = [
            async () => { await delay(100); return 'first'; },
            async () => { await delay(10); return 'second'; },
            async () => { await delay(50); return 'third'; }
        ];

        const results = await parallelLimit(tasks, 3);
        expect(results).toEqual(['first', 'second', 'third']);
    });

    await test('должен обработать пустой массив задач', async () => {
        const results = await parallelLimit([], 2);
        expect(results).toEqual([]);
    });

    await test('должен работать когда limit больше количества задач', async () => {
        const tasks = [
            async () => 1,
            async () => 2,
            async () => 3
        ];

        const results = await parallelLimit(tasks, 10);
        expect(results).toEqual([1, 2, 3]);
    });

    await test('должен выполнять последовательно при limit = 1', async () => {
        let concurrent = 0;
        let maxConcurrent = 0;

        const createTask = (value) => async () => {
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            await delay(20);
            concurrent--;
            return value;
        };

        const tasks = Array(5).fill(0).map((_, i) => createTask(i));
        const results = await parallelLimit(tasks, 1);

        expect(maxConcurrent).toBe(1);
        expect(results).toEqual([0, 1, 2, 3, 4]);
    });

    await test('должен выполнить большое количество задач', async () => {
        const tasks = Array(50).fill(0).map((_, i) => async () => i);
        const results = await parallelLimit(tasks, 5);

        expect(results).toHaveLength(50);
        expect(results[0]).toBe(0);
        expect(results[49]).toBe(49);
    });

    await test('должен правильно обработать ошибку в одной из задач', async () => {
        const tasks = [
            async () => 1,
            async () => { throw new Error('task error'); },
            async () => 3
        ];

        await expect(
            parallelLimit(tasks, 2)
        ).rejects.toThrow('task error');
    });

    await test('должен сохранить порядок даже при разной скорости выполнения', async () => {
        const tasks = Array(20).fill(0).map((_, i) =>
            async () => {
                await delay(Math.random() * 50);
                return i;
            }
        );

        const results = await parallelLimit(tasks, 4);
        expect(results).toEqual(Array(20).fill(0).map((_, i) => i));
    });
});

// ============================================================================
//              ЗАДАНИЕ 3: УМНОЕ КЭШИРОВАНИЕ ЗАПРОСОВ
// ============================================================================

await describe('Задание 3: Умное кэширование запросов', async () => {

    await test('должен закэшировать результат и не вызывать функцию повторно', async () => {
        let callCount = 0;
        const fn = async (x) => {
            callCount++;
            await delay(10);
            return x * 2;
        };

        const cached = createCachedFunction(fn, 1000);

        const result1 = await cached(5);
        const result2 = await cached(5);

        expect(result1).toBe(10);
        expect(result2).toBe(10);
        expect(callCount).toBe(1);
    });

    await test('должен различать запросы с разными аргументами', async () => {
        let callCount = 0;
        const fn = async (x) => {
            callCount++;
            return x * 2;
        };

        const cached = createCachedFunction(fn, 1000);
        await cached(5);
        await cached(10);

        expect(callCount).toBe(2);
    });

    await test('должен очистить кэш после истечения TTL', async () => {
        let callCount = 0;
        const fn = async (x) => {
            callCount++;
            return x * 2;
        };

        const cached = createCachedFunction(fn, 100);
        await cached(5);
        await delay(150);
        await cached(5);

        expect(callCount).toBe(2);
    });

    await test('должен дедуплицировать одновременные запросы', async () => {
        let callCount = 0;
        const fn = async (x) => {
            callCount++;
            await delay(50);
            return x * 2;
        };

        const cached = createCachedFunction(fn, 1000);
        const results = await Promise.all([
            cached(5),
            cached(5),
            cached(5)
        ]);

        expect(results).toEqual([10, 10, 10]);
        expect(callCount).toBe(1);
    });

    await test('НЕ должен кэшировать результат при ошибке', async () => {
        let callCount = 0;
        const fn = async (x) => {
            callCount++;
            if (callCount === 1) throw new Error('first call fails');
            return x * 2;
        };

        const cached = createCachedFunction(fn, 1000);

        await expect(cached(5)).rejects.toThrow('first call fails');

        const result = await cached(5);
        expect(result).toBe(10);
        expect(callCount).toBe(2);
    });

    await test('должен работать с несколькими аргументами', async () => {
        let callCount = 0;
        const fn = async (a, b, c) => {
            callCount++;
            return a + b + c;
        };

        const cached = createCachedFunction(fn, 1000);

        await cached(1, 2, 3);
        await cached(1, 2, 3);
        await cached(1, 2, 4);

        expect(callCount).toBe(2);
    });

    await test('должен работать после ошибки с другими аргументами', async () => {
        const fn = async (x) => {
            if (x === 5) throw new Error('bad value');
            return x * 2;
        };

        const cached = createCachedFunction(fn, 1000);

        await expect(cached(5)).rejects.toThrow('bad value');
        const result = await cached(10);

        expect(result).toBe(20);
    });

    await test('должен дедуплицировать даже большое количество запросов', async () => {
        let callCount = 0;
        const fn = async (x) => {
            callCount++;
            await delay(50);
            return x;
        };

        const cached = createCachedFunction(fn, 1000);
        const promises = Array(100).fill(0).map(() => cached(42));

        await Promise.all(promises);
        expect(callCount).toBe(1);
    });

    await test('должен работать с разными типами данных', async () => {
        let callCount = 0;
        const fn = async (data) => {
            callCount++;
            return data;
        };

        const cached = createCachedFunction(fn, 1000);

        await cached({ a: 1 });
        await cached({ a: 1 });
        await cached({ a: 2 });

        expect(callCount).toBe(2);
    });
});

// ============================================================================
//                    ЗАДАНИЕ 4: ПОИСК С DEBOUNCE
// ============================================================================

await describe('Задание 4: Поиск с debounce', async () => {

    await test('должен выполнить поиск только один раз после серии вызовов', async () => {
        let callCount = 0;
        const searchFn = async (query) => {
            callCount++;
            return `results for ${query}`;
        };

        const debouncedSearch = createDebouncedSearch(searchFn, 100);

        debouncedSearch('a');
        debouncedSearch('ab');
        const promise = debouncedSearch('abc');

        const result = await promise;

        expect(callCount).toBe(1);
        expect(result).toBe('results for abc');
    });

    await test('должен выполнить повторный вызов после паузы', async () => {
        let callCount = 0;
        const searchFn = async (query) => {
            callCount++;
            return `results for ${query}`;
        };

        const debouncedSearch = createDebouncedSearch(searchFn, 100);

        await debouncedSearch('first');
        await delay(150);
        await debouncedSearch('second');

        expect(callCount).toBe(2);
    });

    await test('должен обработать ошибку в searchFn', async () => {
        const searchFn = async () => {
            throw new Error('search failed');
        };

        const debouncedSearch = createDebouncedSearch(searchFn, 50);

        await expect(
            debouncedSearch('query')
        ).rejects.toThrow('search failed');
    });

    await test('должен отменить много быстрых вызовов подряд', async () => {
        let callCount = 0;
        const searchFn = async (query) => {
            callCount++;
            return query;
        };

        const debouncedSearch = createDebouncedSearch(searchFn, 100);

        for (let i = 0; i < 10; i++) {
            debouncedSearch(`query${i}`);
            await delay(10);
        }

        const result = await debouncedSearch('final');

        expect(callCount).toBe(1);
        expect(result).toBe('final');
    });

    await test('должен работать с разными аргументами', async () => {
        const results = [];
        const searchFn = async (query, filter) => {
            results.push({ query, filter });
            return 'ok';
        };

        const debouncedSearch = createDebouncedSearch(searchFn, 50);

        debouncedSearch('test', 'all');
        await debouncedSearch('test', 'active');

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({ query: 'test', filter: 'active' });
    });

    await test('должен вернуть новый Promise на каждый вызов', async () => {
        const searchFn = async (q) => q;
        const debouncedSearch = createDebouncedSearch(searchFn, 50);

        const p1 = debouncedSearch('a');
        const p2 = debouncedSearch('ab');

        expect(p1).toBeInstanceOf(Promise);
        expect(p2).toBeInstanceOf(Promise);
    });
});

// ============================================================================
//                  ЗАДАНИЕ 5: FASTEST RESPONSE WINS
// ============================================================================

await describe('Задание 5: Fastest Response Wins', async () => {

    await test('должен вернуть самый быстрый результат', async () => {
        const fetchFns = [
            async () => { await delay(100); return 'slow'; },
            async () => { await delay(10); return 'fast'; },
            async () => { await delay(200); return 'slowest'; }
        ];

        const result = await fetchFromFastest(fetchFns);
        expect(result.data).toBe('fast');
        expect(result.source).toBe(1);
    });

    await test('должен пропустить неудачные запросы и вернуть успешный', async () => {
        const fetchFns = [
            async () => { await delay(50); throw new Error('fail1'); },
            async () => { await delay(100); return 'success'; },
            async () => { await delay(10); throw new Error('fail2'); }
        ];

        const result = await fetchFromFastest(fetchFns);
        expect(result.data).toBe('success');
    });

    await test('должен выбросить ошибку если все источники упали', async () => {
        const fetchFns = [
            async () => { throw new Error('error1'); },
            async () => { throw new Error('error2'); }
        ];

        await expect(
            fetchFromFastest(fetchFns)
        ).rejects.toThrow('All sources failed');
    });

    await test('должен работать с одним источником', async () => {
        const fetchFns = [
            async () => 'only one'
        ];

        const result = await fetchFromFastest(fetchFns);
        expect(result.data).toBe('only one');
        expect(result.source).toBe(0);
    });

    await test('должен вернуть правильный индекс источника', async () => {
        const fetchFns = [
            async () => { await delay(30); return 'third'; },
            async () => { await delay(10); return 'first'; },
            async () => { await delay(20); return 'second'; }
        ];

        const result = await fetchFromFastest(fetchFns);
        expect(result.source).toBe(1);
    });

    await test('должен содержать информацию об ошибках при полном провале', async () => {
        const fetchFns = [
            async () => { throw new Error('error1'); },
            async () => { throw new Error('error2'); },
            async () => { throw new Error('error3'); }
        ];

        try {
            await fetchFromFastest(fetchFns);
            throw new Error('Should have thrown');
        } catch (error) {
            expect(error.errors).toBeDefined();
            expect(error.errors).toHaveLength(3);
            expect(error.errors[0].source).toBe(0);
            expect(error.errors[1].source).toBe(1);
        }
    });

    await test('должен вернуть первый успешный даже если остальные ещё не завершились', async () => {
        const startTime = Date.now();

        const fetchFns = [
            async () => { await delay(500); return 'very slow'; },
            async () => { await delay(50); return 'fast enough'; },
            async () => { await delay(1000); return 'extremely slow'; }
        ];

        const result = await fetchFromFastest(fetchFns);
        const duration = Date.now() - startTime;

        expect(result.data).toBe('fast enough');
        expect(duration).toBeLessThan(200);
    });

    await test('должен обработать смешанный случай: быстрая ошибка и медленный успех', async () => {
        const fetchFns = [
            async () => { await delay(5); throw new Error('fast fail'); },
            async () => { await delay(50); return 'eventual success'; }
        ];

        const result = await fetchFromFastest(fetchFns);
        expect(result.data).toBe('eventual success');
        expect(result.source).toBe(1);
    });
});

console.log('\n=== ВСЕ ТЕСТЫ ЗАВЕРШЕНЫ ===');