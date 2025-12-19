/**
 * ============================================================================
 *                     ЛАБОРАТОРНАЯ РАБОТА ПО JAVASCRIPT
 *              АСИНХРОННОЕ ПРОГРАММИРОВАНИЕ И РАБОТА С PROMISES
 * ============================================================================
 */

// ============================================================================
//                        ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
//                     ЗАДАНИЕ 1: SMART API FETCHER
// ============================================================================
async function smartFetch(fetchFn, options = {}) {
  // 1. Деструктурируйте options с значениями по умолчанию
  const { timeout = 5000, retries = 3, retryDelay = 1000 } = options;

  // 2. Сохраните startTime = Date.now()
  const startTime = Date.now();
  let lastError;

  // 3. В цикле for (let attempt = 1; attempt <= retries; attempt++)
  //    Note: Используем attempt <= retries + 1, потому что первая попытка не считается как "retry"
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      // 4. Создайте Promise.race между fetchFn() и timeoutPromise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout);
      });

      const data = await Promise.race([fetchFn(), timeoutPromise]);

      // 5. При успехе верните { data, duration, attempts }
      const duration = Date.now() - startTime;
      return { data, duration, attempts: attempt };
    } catch (error) {
      lastError = error;
      // 6. При ошибке: если не последняя попытка - await delay(retryDelay)
      if (attempt <= retries) {
        await delay(retryDelay);
      }
    }
  }

  // 7. После цикла бросьте ошибку
  throw lastError;
}

// ============================================================================
//                ЗАДАНИЕ 2: ПАРАЛЛЕЛЬНАЯ ЗАГРУЗКА С ЛИМИТОМ
// ============================================================================
async function parallelLimit(tasks, limit) {
  // 1. Создайте results = new Array(tasks.length)
  const results = new Array(tasks.length);
  // 2. Создайте currentIndex = 0
  let currentIndex = 0;

  // 3. Создайте async функцию executeTask(), которая:
  async function worker() {
    //    - В цикле while (currentIndex < tasks.length)
    while (currentIndex < tasks.length) {
      //    - Берёт index = currentIndex++
      const index = currentIndex++;
      try {
        //    - Выполняет results[index] = await tasks[index]()
        results[index] = await tasks[index]();
      } catch (error) {
        // Если задача падает - выбрасываем ошибку, чтобы остановить всех воркеров
        // Это соответствует поведению, ожидаемому в тесте на обработку ошибок
        throw error;
      }
    }
  }

  // 4. Создайте массив воркеров: Array(Math.min(limit, tasks.length)).fill().map(() => executeTask())
  const workers = Array(Math.min(limit, tasks.length)).fill().map(() => worker());

  // 5. await Promise.all(workers)
  await Promise.all(workers);

  // 6. Верните results
  return results;
}

// ============================================================================
//                ЗАДАНИЕ 3: УМНОЕ КЭШИРОВАНИЕ ЗАПРОСОВ
// ============================================================================
function createCachedFunction(fn, ttl) {
  // 1. Создайте const cache = new Map() и const pending = new Map()
  const cache = new Map();
  const pending = new Map();

  // 2. Верните async function(...args)
  return async function (...args) {
    // 3. Создайте key = JSON.stringify(args)
    const key = JSON.stringify(args);

    // 4. Проверьте cache.has(key) - если есть, верните cache.get(key)
    if (cache.has(key)) {
      return cache.get(key);
    }

    // 5. Проверьте pending.has(key) - если есть, верните pending.get(key)
    if (pending.has(key)) {
      return pending.get(key);
    }

    // 6. Создайте promise = fn(...args).then(...).catch(...)
    const promise = fn(...args)
      .then(result => {
        // 7. В then: cache.set, pending.delete, setTimeout для удаления из cache
        cache.set(key, result);
        pending.delete(key);
        setTimeout(() => cache.delete(key), ttl);
        return result;
      })
      .catch(error => {
        // 8. В catch: pending.delete, throw error
        pending.delete(key);
        throw error;
      });

    // 9. pending.set(key, promise)
    pending.set(key, promise);

    // 10. Верните promise
    return promise;
  };
}

// ============================================================================
//                    ЗАДАНИЕ 4: ПОИСК С DEBOUNCE
// ============================================================================
function createDebouncedSearch(searchFn, delayMs) {
  // 1. Создайте let timeoutId в замыкании
  let timeoutId = null;

  // 2. Верните function(...args)
  return function (...args) {
    // 3. Если timeoutId существует - clearTimeout(timeoutId)
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // 4. Верните new Promise((resolve, reject) => ...)
    return new Promise((resolve, reject) => {
      // 5. timeoutId = setTimeout(async () => { ... }, delayMs)
      timeoutId = setTimeout(async () => {
        try {
          // 6. В setTimeout: try/catch с await searchFn(...args)
          const result = await searchFn(...args);
          // 7. resolve(result) при успехе
          resolve(result);
        } catch (error) {
          // reject(error) при ошибке
          reject(error);
        }
      }, delayMs);
    });
  };
}

// ============================================================================
//                  ЗАДАНИЕ 5: FASTEST RESPONSE WINS
// ============================================================================
async function fetchFromFastest(fetchFns) {
  // 1. Оберните каждую функцию: promises = fetchFns.map((fn, index) => fn().then(data => ({ data, source: index })))
  const promises = fetchFns.map((fn, index) =>
    fn()
      .then(data => ({ data, source: index }))
      .catch(error => ({ error, source: index }))
  );

  // 2. В try/catch: попробуйте Promise.race(promises)
  try {
    const fastest = await Promise.race(promises);
    // Если самый быстрый результат успешен (содержит data), возвращаем его
    if ('data' in fastest) {
      return fastest;
    }
    // Если самый быстрый был с ошибкой, пробуем найти любой успешный среди всех
    throw new Error('First response was an error');
  } catch {
    // 3. В catch: используйте Promise.allSettled(promises)
    const allResults = await Promise.allSettled(promises);

    // 4. Найдите первый fulfilled: results.find(r => r.status === 'fulfilled')
    // Преобразуем структуру: из Promise.allSettled получаем объекты {status, value/reason}
    const settledValues = allResults.map(result => result.value || result.reason);
    const successful = settledValues.find(result => 'data' in result);

    // 5. Если нашли - верните successful.value
    if (successful) {
      return successful;
    }

    // 6. Иначе соберите все ошибки и бросьте Error с полем errors
    const errors = settledValues.filter(result => 'error' in result);
    const error = new Error('All sources failed');
    error.errors = errors; // Добавляем массив ошибок для соответствия тесту
    throw error;
  }
}

// ============================================================================
//                                ЭКСПОРТ
// ============================================================================
// Для ES модулей (если в package.json указан "type": "module")
export {
  delay,
  smartFetch,
  parallelLimit,
  createCachedFunction,
  createDebouncedSearch,
  fetchFromFastest
};

// Для CommonJS (если используется без ES модулей)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    delay,
    smartFetch,
    parallelLimit,
    createCachedFunction,
    createDebouncedSearch,
    fetchFromFastest
  };
}