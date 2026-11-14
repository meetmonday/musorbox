# Публичное API

JSON API для автоматизации действий от имени пользователя. Базовый путь — `/api`.

## Токены

### Ручной API-токен

Войдите на сайт и откройте **Настройки профиля → API-токен** (`/settings/api`).
Нажмите кнопку создания токена и сохраните показанную строку: повторно её посмотреть нельзя.

У пользователя один ручной токен, без срока действия и уровней доступа. Создание нового
ручного токена сразу отключает предыдущий. Кнопка отзыва отключает текущий ручной токен
без выпуска нового. Токены приложений, описанные ниже, от него не зависят.
Токен действует независимо от браузерной сессии. Заблокированный аккаунт не может им пользоваться.
Токен даёт те же возможности работы с контентом и личными сообщениями, что и аккаунт
на сайте, а не права администратора. Обращайтесь с ним как с паролем: владелец токена
может читать и отправлять сообщения от вашего имени.

Передавайте токен только в заголовке `Authorization: Bearer …`, не в URL.
Вне локальной разработки используйте HTTPS. Не публикуйте токен и не храните его в репозитории.
На сервере хранится только SHA-256-хеш токена.

### Вход приложения по логину и паролю

Доверенное приложение может обменять логин и пароль на отдельный bearer-токен:

```bash
curl "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"Reader","password":"секрет"}'
```

Успешный ответ: `201`, `{ok:true,token,tokenType:"Bearer"}`. Пароль используется только
в этом запросе и не должен сохраняться приложением. Выданный токен передаётся в
`Authorization` так же, как ручной API-токен. Один вход не отключает другие приложения
или ручной токен; одновременно сохраняется до 10 токенов приложений на пользователя,
после чего новый вход отзывает самый старый.

Чтобы отозвать только текущий токен приложения, выполните:

```bash
curl -X DELETE "$BASE/api/auth/token" \
  -H "Authorization: Bearer $TOKEN"
```

Для ручного API-токена этот запрос безопасно ничего не меняет. Все токены хранятся на
сервере только в виде SHA-256-хешей. Заблокированный аккаунт не может войти или
использовать ранее выданный токен. Вход ограничен десятью попытками в минуту с одного IP.
Смена пароля и действие «Завершить все входы в приложениях» в `/settings/api` отзывают
все токены приложений.

```bash
BASE='https://ваш-сайт.example'
TOKEN='ваш-токен'

curl "$BASE/api/me" -H "Authorization: Bearer $TOKEN"
curl "$BASE/api/messages" -H "Authorization: Bearer $TOKEN"
curl "$BASE/api/topics"
curl "$BASE/api/categories"
curl "$BASE/api/tags"
```

Чтение публичного контента и `POST /api/auth/login` не требуют токена. Для остальных
запросов записи, `/api/me` и всех методов `/api/messages…` токен обязателен;
браузерная cookie его не заменяет. Если заголовок `Authorization` передан, но неверен,
даже публичный запрос вернёт `401`.

За прокси или туннелем задайте `PUBLIC_BASE_URL` равным внешнему адресу сайта
(например, `https://portal.example`), а не внутреннему HTTP-адресу Bun.
Форма создания и отзыва токена проверяет `Origin`/`Referer` относительно этого адреса.
Открывайте настройки по этому же адресу; после изменения переменной перезапустите приложение.

Запросы с телом используют `Content-Type: application/json`. Даты в ответах — строки ISO 8601.
Скрытый контент не доступен через API.

## Эндпоинты

| Метод и путь | Назначение |
| --- | --- |
| `POST /api/auth/login` | Обменять логин и пароль на отдельный токен приложения |
| `DELETE /api/auth/token` | Отозвать текущий токен приложения |
| `GET /api/me` | Текущий пользователь: `{ok:true,user}` |
| `GET /api/categories` | Категории: `{ok:true,items}` |
| `GET /api/tags` | Теги: `{ok:true,items}` |
| `GET /api/topics` | Лента или поиск: `{ok:true,items,total,page,limit}` |
| `GET /api/topics/:id` | Топик: `{ok:true,topic}` |
| `POST /api/topics` | Создать топик: `201`, `{ok:true,topic}` |
| `PATCH /api/topics/:id` | Изменить топик: `{ok:true,topic}` |
| `DELETE /api/topics/:id` | Удалить топик: `{ok:true}` |
| `GET /api/topics/:id/comments` | Комментарии: `{ok:true,items}` |
| `POST /api/topics/:id/comments` | Добавить комментарий: `201`, `{ok:true,comment}` |
| `PATCH /api/comments/:id` | Изменить комментарий: `{ok:true,comment}` |
| `DELETE /api/comments/:id` | Удалить комментарий: `{ok:true}` |
| `POST /api/topics/:id/vote` | Голос за топик: `{ok:true,up,down}` |
| `POST /api/comments/:id/vote` | Голос за комментарий: `{ok:true,up,down}` |
| `GET /api/messages` | Личные и групповые чаты: `{ok:true,items,unreadCount}` |
| `GET /api/messages/users` | Поиск локальных пользователей по логину |
| `GET /api/messages/direct/:username` | История личного диалога |
| `GET /api/messages/direct/:username/updates` | Новые сообщения личного диалога после `after` |
| `POST /api/messages/direct/:username` | Отправить личное сообщение |
| `GET /api/messages/events` | Realtime-события сообщений (SSE) |
| `POST /api/messages/groups` | Создать групповой чат |
| `GET /api/messages/groups/:id` | История, участники и приглашение группы |
| `GET /api/messages/groups/:id/updates` | Новые сообщения группы после `after` |
| `POST /api/messages/groups/:id/messages` | Отправить сообщение в группу |
| `POST /api/messages/groups/:id/members` | Добавить участника (владелец) |
| `DELETE /api/messages/groups/:id/members/:userId` | Удалить участника (владелец) |
| `POST /api/messages/groups/:id/invite/reset` | Заменить ссылку-приглашение (владелец) |
| `POST /api/messages/groups/join` | Вступить по токену приглашения |
| `POST /api/messages/groups/:id/leave` | Покинуть группу |
| `DELETE /api/messages/groups/:id` | Удалить группу (владелец) |

Все `:id` — положительные целые числа. Форумные темы — те же топики в категории форума.
Список комментариев возвращается целиком; `parentId` связывает ответы с родителями.

### Лента и поиск

Параметры `GET /api/topics`: `page` (от 1, по умолчанию 1), `limit` (1–100,
по умолчанию 20), `category` (slug категории) или `q` (поиск в заголовке и тексте).
`q` и `category` одновременно не поддерживаются. Поиск учитывает кириллицу без учёта
регистра; при выходе за последнюю страницу возвращается последняя, её номер указан в `page`.

```bash
curl --get "$BASE/api/topics" --data-urlencode 'q=телефон' --data 'limit=10'
curl "$BASE/api/topics?category=news&page=1&limit=20"
```

### Топики

При создании обязательны `title` (1–200 символов), `body` (HTML, до 200000 символов)
и `categoryId` (число из `/api/categories`). Необязательное `tagIds` — массив ID тегов
групп `os` и `quest`, максимум 10. Категория `index` недоступна для публикации.
HTML очищается сервером; slug и обложка формируются автоматически.

При изменении передайте хотя бы одно из этих полей. Пропущенные поля сохраняются,
`tagIds: []` удаляет теги. Изменять и удалять топик может автор, редактор или администратор.

```bash
curl "$BASE/api/topics" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Топик из скрипта","body":"<p>Привет!</p>","categoryId":2}'

curl -X PATCH "$BASE/api/topics/123" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"title":"Новый заголовок"}'
```

### Комментарии и голоса

Комментарий: `body` — непустая строка до 4000 символов. `parentId` — ID комментария
этого же топика или `null` (по умолчанию). Изменять комментарий может только его автор;
удалять — автор, редактор или администратор. Комментарий с ответами удалить нельзя (`409`).
Комментарии с других серверов нельзя редактировать как локальные.

```bash
curl "$BASE/api/topics/123/comments" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"body":"Ответ из скрипта","parentId":null}'

curl "$BASE/api/topics/123/vote" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"value":1}'

curl -X DELETE "$BASE/api/comments/456" -H "Authorization: Bearer $TOKEN"
```

Голос `value` — число `1` или `-1`. Повтор того же голоса возвращает ошибку;
противоположный голос заменяет предыдущий. `up` и `down` — новые счётчики.
Публикация и удаление используют те же уведомления и федерацию, что и сайт.

## Личные сообщения

Все методы сообщений требуют действующий Bearer-токен. Переписка доступна только
обычным локальным аккаунтам сайта. Теневые профили Telegram и удалённые акторы
ActivityPub/Mastodon не появляются в поиске, им нельзя писать и их нельзя добавлять
в группы.

`GET /api/me` дополнительно возвращает `unreadMessagesCount` — общее число
непрочитанных личных и групповых сообщений.

### Список чатов и поиск пользователей

`GET /api/messages?limit=50` возвращает до 100 чатов, новые первыми. Элементы имеют
поле `kind`:

- `direct` — личный диалог; объект содержит `partner`, `lastMessage` и `unreadCount`;
- `group` — группа; объект содержит `title`, `memberCount`, `lastMessage` и `unreadCount`.

`unreadCount` верхнего уровня — суммарное число непрочитанных сообщений. Параметр
`limit` необязателен, по умолчанию 50, максимум 100.

Поиск адресата выполняется через
`GET /api/messages/users?q=Reader&limit=20`. `q` обязателен, `limit` — от 1 до 30.

```bash
curl "$BASE/api/messages?limit=30" \
  -H "Authorization: Bearer $TOKEN"

curl --get "$BASE/api/messages/users" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'q=Reader'
```

### Личный диалог

`GET /api/messages/direct/:username` возвращает `{ok:true,thread}`. В `thread` входят
`partner`, массив `messages`, `hasOlder`, `olderBefore` и `readThroughId`.
Один запрос возвращает до 60 последних сообщений и отмечает полученные сообщения
прочитанными.

Для более старой страницы передайте `before=<olderBefore>`. Для фонового обновления
используйте `GET /api/messages/direct/:username/updates?after=<последний_id>`:
он возвращает до 100 новых сообщений и актуальный `readThroughId`.

Сообщение — обычный текст, не HTML, от 1 до 4000 Unicode-символов. Общий лимит
для личных и групповых сообщений — 30 отправок в минуту на пользователя.

```bash
curl "$BASE/api/messages/direct/Reader" \
  -H "Authorization: Bearer $TOKEN"

curl "$BASE/api/messages/direct/Reader/updates?after=120" \
  -H "Authorization: Bearer $TOKEN"

curl "$BASE/api/messages/direct/Reader" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"body":"Привет из API"}'
```

Успешная отправка возвращает `201` и `{ok:true,message}`.

## Групповые чаты

Создание группы:

```bash
curl "$BASE/api/messages/groups" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Редакция","members":["Reader","Helper"]}'
```

`title` содержит 2–80 символов. `members` необязателен — группу можно создать пустой
и затем раздать приглашение. Допускается до 49 начальных логинов и до 50 участников
вместе с владельцем. Ответ: `201`, заголовок `Location` и `{ok:true,thread}`.

`GET /api/messages/groups/:id` возвращает историю, `members`, роль текущего
пользователя и объект `group` с абсолютным `inviteUrl`. История использует тот же
параметр `before`, что и личный диалог. Новые сообщения запрашиваются через
`GET /api/messages/groups/:id/updates?after=<id>`.

```bash
curl "$BASE/api/messages/groups/42/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"body":"Всем привет"}'

curl "$BASE/api/messages/groups/42/members" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"username":"Newbie"}'

curl -X DELETE "$BASE/api/messages/groups/42/members/17" \
  -H "Authorization: Bearer $TOKEN"
```

Добавлять и удалять участников, удалять чат и заменять приглашение может только
владелец. Обычный участник может выполнить `POST /api/messages/groups/:id/leave`.
Владелец не может выйти из группы; передача владения сейчас не поддерживается, поэтому
он может только удалить чат.

### Вступление по ссылке

Последняя часть `inviteUrl` после `/join/` — токен приглашения. Передайте его в API:

```bash
curl "$BASE/api/messages/groups/join" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"token":"ТОКЕН_ИЗ_ССЫЛКИ"}'
```

Повторный вызов для участника безопасен и возвращает тот же `groupId`. Новый участник
может читать прежнюю историю, но старые сообщения не считаются непрочитанными.
`POST /api/messages/groups/:id/invite/reset` возвращает новый `inviteUrl` и сразу
отключает старую ссылку.

## Realtime сообщений

`GET /api/messages/events` — поток Server-Sent Events. Передайте Bearer-токен в
заголовке; токены в URL не поддерживаются.

```bash
curl -N "$BASE/api/messages/events" \
  -H "Authorization: Bearer $TOKEN"
```

События:

- `ready` — соединение установлено;
- `message` — появилось сообщение;
- `read` — изменился статус прочтения личного сообщения;
- `ping` — служебное событие примерно раз в 15 секунд.

Для личного диалога `data` выглядит как
`{"type":"message","peerId":4,"messageId":121}`, для группы —
`{"type":"message","groupId":42,"messageId":77}`. Сам текст намеренно не
передаётся в событии: после сигнала запросите соответствующий `updates?after=…`.
После переподключения также всегда выполняйте `updates`: события не являются
долговременной очередью. Одновременно разрешено до 10 потоков сообщений на аккаунт.

Обычный `EventSource` в браузере не умеет задавать `Authorization`; используйте
`fetch()` с потоковым чтением или серверный SSE-клиент. Не передавайте API-токен
через query string.

## Ошибки

Формат: `{ "ok": false, "error": "Описание ошибки" }`.
`400` — неверные поля/JSON/параметры, `401` — нужен действующий токен,
`403` — действие запрещено этому пользователю, `404` — объект отсутствует или скрыт,
`409` — конфликт действия, `415` — нужен JSON, `429` — превышен лимит отправки или
realtime-соединений. API не перенаправляет на страницу входа.
Загрузку файлов, изменение профиля и модерацию этот API не предоставляет.
