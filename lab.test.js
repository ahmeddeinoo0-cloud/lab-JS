import {
  delay, smartFetch, parallelLimit, createCachedFunction, createDebouncedSearch, fetchFromFastest
} from './lab.js';

// ============================================================================
//                     ЗАДАНИЕ 1: SMART API FETCHER
// ============================================================================

describe('Задание 1: Smart API Fetcher', () => {
  
  test('должен выполнить успешный запрос с первой попытки', async () => {
    // Подсказка: проверяем базовый случай - запрос работает нормально
    const fetchFn = async () => ({ message: 'success' });
    const result = await smartFetch(fetchFn);
    
    expect(result.data.message).toBe('success');
    expect(result.attempts).toBe(1);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  test('должен повторить запрос при ошибке и вернуть результат', async () => {
    // Подсказка: используйте счётчик попыток в замыкании
    // Первые 2 попытки - ошибка, третья - успех
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

  test('должен выбросить ошибку после исчерпания всех попыток', async () => {
    // Подсказка: если все попытки неудачны - бросаем последнюю ошибку
    const fetchFn = async () => {
      throw new Error('always fails');
    };
    
    await expect(
      smartFetch(fetchFn, { retries: 2 })
    ).rejects.toThrow('always fails');
  });

  test('должен применить таймаут и выбросить ошибку', async () => {
    // Подсказка: Promise.race - запрос vs таймаут
    // Если запрос длится дольше timeout - должна быть ошибка
    const fetchFn = async () => {
      await delay(200);
      return { message: 'too slow' };
    };
    
    await expect(
      smartFetch(fetchFn, { timeout: 100, retries: 1 })
    ).rejects.toThrow('Timeout');
  });

  test('должен использовать дефолтные значения опций', async () => {
    // Подсказка: проверяем что дефолтные значения применяются
    const fetchFn = async () => 'ok';
    const result = await smartFetch(fetchFn);
    
    expect(result.data).toBe('ok');
    expect(result.attempts).toBe(1);
  });

  test('должен корректно измерять время выполнения', async () => {
    // Подсказка: duration должен быть примерно равен задержке
    const fetchFn = async () => {
      await delay(50);
      return 'data';
    };
    
    const result = await smartFetch(fetchFn);
    expect(result.duration).toBeGreaterThanOrEqual(50);
    expect(result.duration).toBeLessThan(100);
  });

  test('должен успешно выполниться со второй попытки', async () => {
    // Подсказка: проверка промежуточного случая retry
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

  test('должен применять retryDelay между попытками', async () => {
    // Подсказка: проверяем что между попытками есть задержка
    let attempts = 0;
    const timestamps = [];
    
    const fetchFn = async () => {
      timestamps.push(Date.now());
      attempts++;
      if (attempts < 3) throw new Error('fail');
      return 'ok';
    };
    
    await smartFetch(fetchFn, { retries: 3, retryDelay: 50 });
    
    // Между первой и второй попыткой должно быть >= 50ms
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(50);
  });

  test('должен учитывать таймаут при retry', async () => {
    // Подсказка: каждая попытка должна проверяться на таймаут
    let attempts = 0;
    const fetchFn = async () => {
      attempts++;
      await delay(150);
      return 'too slow';
    };
    
    await expect(
      smartFetch(fetchFn, { timeout: 100, retries: 2, retryDelay: 10 })
    ).rejects.toThrow();
    
    // Должны быть попытки до исчерпания retries
    expect(attempts).toBeGreaterThan(0);
  });
  
});

// ============================================================================
//              ЗАДАНИЕ 2: ПАРАЛЛЕЛЬНАЯ ЗАГРУЗКА С ЛИМИТОМ
// ============================================================================

describe('Задание 2: Параллельная загрузка с лимитом', () => {
  
  test('должен выполнить все задачи и вернуть результаты', async () => {
    // Подсказка: простейший случай - проверка что все задачи выполнились
    const tasks = [
      async () => 1,
      async () => 2,
      async () => 3
    ];
    
    const results = await parallelLimit(tasks, 2);
    expect(results).toEqual([1, 2, 3]);
  });

  test('должен ограничить количество одновременных задач', async () => {
    // Подсказка: используйте счётчик concurrent++/concurrent--
    // maxConcurrent не должен превысить limit
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

  test('должен сохранить порядок результатов', async () => {
    // Подсказка: даже если вторая задача завершится быстрее первой,
    // результаты должны быть в исходном порядке
    const tasks = [
      async () => { await delay(100); return 'first'; },
      async () => { await delay(10); return 'second'; },
      async () => { await delay(50); return 'third'; }
    ];
    
    const results = await parallelLimit(tasks, 3);
    expect(results).toEqual(['first', 'second', 'third']);
  });

  test('должен обработать пустой массив задач', async () => {
    // Подсказка: граничный случай - нет задач
    const results = await parallelLimit([], 2);
    expect(results).toEqual([]);
  });

  test('должен работать когда limit больше количества задач', async () => {
    // Подсказка: если limit = 10, а задач 3, все 3 должны выполниться параллельно
    const tasks = [
      async () => 1,
      async () => 2,
      async () => 3
    ];
    
    const results = await parallelLimit(tasks, 10);
    expect(results).toEqual([1, 2, 3]);
  });

  test('должен выполнять последовательно при limit = 1', async () => {
    // Подсказка: limit = 1 означает последовательное выполнение
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

  test('должен выполнить большое количество задач', async () => {
    // Подсказка: проверка масштабируемости
    const tasks = Array(50).fill(0).map((_, i) => async () => i);
    const results = await parallelLimit(tasks, 5);
    
    expect(results).toHaveLength(50);
    expect(results[0]).toBe(0);
    expect(results[49]).toBe(49);
  });

  test('должен правильно обработать ошибку в одной из задач', async () => {
    // Подсказка: если задача падает, весь Promise.all должен упасть
    const tasks = [
      async () => 1,
      async () => { throw new Error('task error'); },
      async () => 3
    ];
    
    await expect(
      parallelLimit(tasks, 2)
    ).rejects.toThrow('task error');
  });

  test('должен сохранить порядок даже при разной скорости выполнения', async () => {
    // Подсказка: более сложный тест на порядок
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

describe('Задание 3: Умное кэширование запросов', () => {
  
  test('должен закэшировать результат и не вызывать функцию повторно', async () => {
    // Подсказка: при одинаковых аргументах функция вызывается только раз
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

  test('должен различать запросы с разными аргументами', async () => {
    // Подсказка: разные аргументы = разные ключи в кэше
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

  test('должен очистить кэш после истечения TTL', async () => {
    // Подсказка: setTimeout для удаления из кэша через ttl мс
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

  test('должен дедуплицировать одновременные запросы', async () => {
    // Подсказка: если 3 одинаковых запроса идут параллельно,
    // должен выполниться только один реальный запрос
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

  test('НЕ должен кэшировать результат при ошибке', async () => {
    // Подсказка: если функция упала с ошибкой, не сохраняем в кэш
    let callCount = 0;
    const fn = async (x) => {
      callCount++;
      if (callCount === 1) throw new Error('first call fails');
      return x * 2;
    };
    
    const cached = createCachedFunction(fn, 1000);
    
    await expect(cached(5)).rejects.toThrow('first call fails');
    
    // Второй вызов должен попробовать снова
    const result = await cached(5);
    expect(result).toBe(10);
    expect(callCount).toBe(2);
  });

  test('должен работать с несколькими аргументами', async () => {
    // Подсказка: проверка что JSON.stringify работает с массивом аргументов
    let callCount = 0;
    const fn = async (a, b, c) => {
      callCount++;
      return a + b + c;
    };
    
    const cached = createCachedFunction(fn, 1000);
    
    await cached(1, 2, 3);
    await cached(1, 2, 3);
    await cached(1, 2, 4); // другие аргументы
    
    expect(callCount).toBe(2);
  });

  test('должен работать после ошибки с другими аргументами', async () => {
    // Подсказка: ошибка с одними аргументами не влияет на другие
    const fn = async (x) => {
      if (x === 5) throw new Error('bad value');
      return x * 2;
    };
    
    const cached = createCachedFunction(fn, 1000);
    
    await expect(cached(5)).rejects.toThrow('bad value');
    const result = await cached(10);
    
    expect(result).toBe(20);
  });

  test('должен дедуплицировать даже большое количество запросов', async () => {
    // Подсказка: проверка что дедупликация работает масштабно
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

  test('должен работать с разными типами данных', async () => {
    // Подсказка: проверка что кэширование работает с объектами, строками и т.д.
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

describe('Задание 4: Поиск с debounce', () => {
  
  test('должен выполнить поиск только один раз после серии вызовов', async () => {
    // Подсказка: если вызовы идут подряд без паузы - выполняется только последний
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

  test('должен выполнить повторный вызов после паузы', async () => {
    // Подсказка: если между вызовами прошло больше delayMs - это новый запрос
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

  test('должен обработать ошибку в searchFn', async () => {
    // Подсказка: если searchFn бросает ошибку, Promise должен reject
    const searchFn = async () => {
      throw new Error('search failed');
    };
    
    const debouncedSearch = createDebouncedSearch(searchFn, 50);
    
    await expect(
      debouncedSearch('query')
    ).rejects.toThrow('search failed');
  });

  test('должен отменить много быстрых вызовов подряд', async () => {
    // Подсказка: симуляция быстрого ввода пользователя
    let callCount = 0;
    const searchFn = async (query) => {
      callCount++;
      return query;
    };
    
    const debouncedSearch = createDebouncedSearch(searchFn, 100);
    
    // Быстрые вызовы
    for (let i = 0; i < 10; i++) {
      debouncedSearch(`query${i}`);
      await delay(10);
    }
    
    const result = await debouncedSearch('final');
    
    expect(callCount).toBe(1);
    expect(result).toBe('final');
  });

  test('должен работать с разными аргументами', async () => {
    // Подсказка: проверка что аргументы правильно передаются
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

  test('должен вернуть новый Promise на каждый вызов', async () => {
    // Подсказка: каждый вызов создаёт свой промис
    const searchFn = async (q) => q;
    const debouncedSearch = createDebouncedSearch(searchFn, 50);
    
    const p1 = debouncedSearch('a');
    const p2 = debouncedSearch('ab');
    
    expect(p1).not.toBe(p2);
    expect(p1).toBeInstanceOf(Promise);
    expect(p2).toBeInstanceOf(Promise);
  });
  
});

// ============================================================================
//                  ЗАДАНИЕ 5: FASTEST RESPONSE WINS
// ============================================================================

describe('Задание 5: Fastest Response Wins', () => {
  
  test('должен вернуть самый быстрый результат', async () => {
    // Подсказка: Promise.race выберет первый завершившийся промис
    const fetchFns = [
      async () => { await delay(100); return 'slow'; },
      async () => { await delay(10); return 'fast'; },
      async () => { await delay(200); return 'slowest'; }
    ];
    
    const result = await fetchFromFastest(fetchFns);
    expect(result.data).toBe('fast');
    expect(result.source).toBe(1);
  });

  test('должен пропустить неудачные запросы и вернуть успешный', async () => {
    // Подсказка: если самый быстрый упал с ошибкой,
    // используем Promise.allSettled для поиска успешного
    const fetchFns = [
      async () => { await delay(50); throw new Error('fail1'); },
      async () => { await delay(100); return 'success'; },
      async () => { await delay(10); throw new Error('fail2'); }
    ];
    
    const result = await fetchFromFastest(fetchFns);
    expect(result.data).toBe('success');
  });

  test('должен выбросить ошибку если все источники упали', async () => {
    // Подсказка: если все промисы rejected - бросаем ошибку с массивом errors
    const fetchFns = [
      async () => { throw new Error('error1'); },
      async () => { throw new Error('error2'); }
    ];
    
    await expect(
      fetchFromFastest(fetchFns)
    ).rejects.toThrow('All sources failed');
  });

  test('должен работать с одним источником', async () => {
    // Подсказка: граничный случай - только один источник
    const fetchFns = [
      async () => 'only one'
    ];
    
    const result = await fetchFromFastest(fetchFns);
    expect(result.data).toBe('only one');
    expect(result.source).toBe(0);
  });

  test('должен вернуть правильный индекс источника', async () => {
    // Подсказка: проверка что source содержит правильный индекс
    const fetchFns = [
      async () => { await delay(30); return 'third'; },
      async () => { await delay(10); return 'first'; },
      async () => { await delay(20); return 'second'; }
    ];
    
    const result = await fetchFromFastest(fetchFns);
    expect(result.source).toBe(1);
  });

  test('должен содержать информацию об ошибках при полном провале', async () => {
    // Подсказка: error.errors должен содержать массив с информацией о всех ошибках
    const fetchFns = [
      async () => { throw new Error('error1'); },
      async () => { throw new Error('error2'); },
      async () => { throw new Error('error3'); }
    ];
    
    try {
      await fetchFromFastest(fetchFns);
      fail('Should have thrown');
    } catch (error) {
      expect(error.errors).toBeDefined();
      expect(error.errors).toHaveLength(3);
      expect(error.errors[0].source).toBe(0);
      expect(error.errors[1].source).toBe(1);
    }
  });

  test('должен вернуть первый успешный даже если остальные ещё не завершились', async () => {
    // Подсказка: race должен вернуть результат не дожидаясь всех
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

  test('должен обработать смешанный случай: быстрая ошибка и медленный успех', async () => {
    // Подсказка: если первый упал быстро, должен дождаться успешного
    const fetchFns = [
      async () => { await delay(5); throw new Error('fast fail'); },
      async () => { await delay(50); return 'eventual success'; }
    ];
    
    const result = await fetchFromFastest(fetchFns);
    expect(result.data).toBe('eventual success');
    expect(result.source).toBe(1);
  });
  
});
