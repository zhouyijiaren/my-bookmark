const Base = require('./base.js');
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const read = require('node-readability');
const cheerio = require('cheerio');

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
};

module.exports = class extends Base {
  async __before() {
    if (['userRegister', 'userLogin', 'noteShare', 'bookmarkDownload', 'hotBookmarks', 'hotBookmarksRandom'].indexOf(this.ctx.action) >= 0) {
      return;
    }
    try {
      let user = await this.session('user');
      if (think.isEmpty(user.id)) {
        return this.fail(401, '请先登录');
      }
      this.ctx.state.user = user;
    } catch (error) {
      // 获取用户的 session 信息，如果为空，返回 false 阻止后续的行为继续执行
      return this.fail(401, '请先登录:' + error.toString());
    }
  }

  indexAction() {
    return this.display();
  }

  // 注册
  async userRegisterAction() {
    try {
      let post = this.post();
      post.password = md5(post.password); // 进行密码加密

      let res = await this.model("users").add(post);
      this.json({ code: 0, data: res, msg: "注册成功" });
    } catch (error) {
      this.json({ code: 1, data: '', msg: error.toString() });
    }
  }

  // 登陆
  async userLoginAction() {
    try {
      let post = this.post();
      post.password = md5(post.password); // 进行密码加密

      let user = await this.model('users').where({ username: post.username, password: post.password }).find();
      if (think.isEmpty(user)) {
        this.json({ code: 2, msg: "账号或者密码错误" });
      } else {
        delete user.password;
        const token = await this.session('user', {
          id: user.id,
          username: user.username
        });
        user.token = token;
        this.json({ code: 0, data: user, msg: "登陆成功" });
      }
    } catch (error) {
      this.json({ code: 1, data: '', msg: error.toString() });
    }
  }

  // 登出
  async userLogoutAction() {
    await this.session(null);
    this.json({ code: 0, data: '', msg: "退出成功" });
  }

  async userUpdateAction() {
    let user = this.post();
    try {
      let data = await this.model('users').where({ id: this.ctx.state.user.id }).update(user);
      this.json({ code: 0, data });
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  async userResetPwdAction() {
    let old = md5(this.post("old"));
    let password = md5(this.post("password"));

    try {
      let user = await this.model('users').where({ id: this.ctx.state.user.id, password: old }).find();
      if (!think.isEmpty(user)) {
        let data = await this.model('users').where({ id: this.ctx.state.user.id }).update({ password });
        this.json({ code: 0, data, msg: "密码更新成功!" });
      } else {
        this.json({ code: 0, data: 0, msg: "旧密码认证失败!" });
      }
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  // 通过session获取自己信息
  async userAction() {
    let full = this.get("full");
    let id = this.get("id");
    if (full) {
      let data = await this.model('users').where({ id: id || this.ctx.state.user.id }).find();
      delete data.password;
      this.json({ code: 0, data, msg: '' });
    } else {
      this.json({ code: 0, data: this.ctx.state.user, msg: '' });
    }
  }

  // 获取分类信息
  async tagsAction() {
    /*
    // 这里的查询太慢，使用原始的sql查询先替代
    let param = this.get();
    let tags = await this.model('tags').where({ userId: this.ctx.state.user.id }).order('sort ASC, lastUse DESC').select();
    // 这个分类包含的书签与备忘录的个数
    for (let tag of tags) {
      if (param.bookmarkCount) {
        tag.bookmarkCount = await this.model('bookmarks').where({ tagId: tag.id }).count();
      }
      if (param.noteCount) {
        tag.noteCount = await this.model('notes').where({ tagId: tag.id }).count();
      }
    }
    */
    let sql = "SELECT t.*, tb.bookmarkCount, tg.noteCount FROM `tags` as t LEFT OUTER JOIN ( SELECT `tagId`, COUNT(tagId) as bookmarkCount FROM bookmarks GROUP BY tagId ) tb ON t.id = tb.tagId  LEFT OUTER JOIN ( SELECT `tagId`, COUNT(tagId) as noteCount FROM notes GROUP BY tagId ) tg ON t.id = tg.tagId where t.userId = " + this.ctx.state.user.id;
    let tags = await this.model('tags').query(sql);

    this.json({ code: 0, data: tags, msg: '' });
  }

  async tagAddAction() {
    let name = this.post().name;
    try {
      let res = await this.model("tags").add({
        userId: this.ctx.state.user.id,
        name
      });
      this.json({ code: 0, data: res, msg: `分类 ${name} 添加成功` });
    } catch (error) {
      this.json({ code: 1, data: '', msg: error.toString() });
    }
  }

  // 更新分类
  async tagUpdateAction() {
    let tag = this.post();
    try {
      let data = await this.model('tags').where({
        userId: this.ctx.state.user.id,
        id: tag.id
      }).update(tag);
      this.json({ code: 0, data });
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  // 批量更新排序
  async tagSortAction() {
    let tags = this.post("tags");
    try {
      let data = 0;
      for (const tag of tags) {
        let count = await this.model('tags').where({
          userId: this.ctx.state.user.id,
          id: tag.id
        }).update(tag);
        data += count;
      }
      this.json({ code: 0, data, msg: '分类排序更新成功！' });
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  // 删除分类
  async tagDelAction() {
    let id = this.post("id");
    let tagId = id;
    let userId = this.ctx.state.user.id;
    try {
      let data = await this.model("tags").where({ id, userId }).delete();
      data = await this.model("bookmarks").where({ tagId, userId }).delete();
      this.json({ code: 0, data, msg: `分类删除成功` });
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  // 获取书签
  // @todo 如果是自己的任意获取，如果是别人的必须公开才能获取
  async bookmarkAction() {
    let id = this.get("id");
    try {
      let data = await this.model('bookmarks').where({ id }).find();
      this.json({ code: 0, data });
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  // 添加书签
  async bookmarkAddAction() {
    let bookmark = this.post();
    bookmark.userId = this.ctx.state.user.id;
    console.log(bookmark.tagName)
    try {
      if (!bookmark.tagName) {
        bookmark.tagName = "未分类";
      }
      let tagNames = bookmark.tagName.split(",");
      let tagIds = [];
      for(let index in tagNames) {
        let tagName = tagNames[index];
        console.log(tagName)
        let tag = await this.model("tags").where({ name: tagName}).find();
        if (think.isEmpty(tag)) {
          let tagId = await this.model("tags").add({
            userId: this.ctx.state.user.id,
            name: tagName
          });
          tagIds.push(tagId);
        } else {
          tagIds.push(tag.id);
        }
      }
      bookmark.tagId = tagIds.join(",");
      let data = await this.model("bookmarks").add(bookmark);

      for (var i in tagIds) {
        await this.model('tags').where({
          userId: this.ctx.state.user.id,
          id: i
        }).update({ lastUse: think.datetime(new Date()) });
      }
      this.json({ code: 0, data, msg: `书签 ${bookmark.title} 添加成功` });
    } catch (error) {
      this.json({ code: 1, data: '', msg: error.toString() });
    }
  }

  // 删除书签
  async bookmarkDelAction() {
    let bookmark = this.post();
    bookmark.userId = this.ctx.state.user.id;
    try {
      let data = await this.model("bookmarks").where(bookmark).delete();
      this.json({ code: 0, data, msg: `书签删除成功` });
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  // 根据书签id获取书签
  async bookmarksByTagAction() {
    let tagId = this.get("tagId");
    let showType = this.get("showType") || "createdAt";
    // tagId = -1 个人定制 从自己里面取
    let condition = {};
    let order = showType + ' DESC';
    let page = this.get('page');
    let pageSize = parseInt(this.get('pageSize') || 50);

    if (tagId == -1) {
      condition = { userId: this.ctx.state.user.id };
    } else {
      condition = { tagId };
    }

    try {
      // 如果是第0页而且是个人定制的，把 最近点击 与 最近新增 的返回去。
      let data = {};
      if (page == 0 && tagId == -1) {
        let count = await this.model('bookmarks').where(condition).count('id');
        let totalPages = Math.ceil(count / pageSize);
        // 按照 2:2:1取数据
        let length = Math.ceil(pageSize * 2 / 5);
        let bookmarks = await this.model('bookmarks').where(condition).order('createdAt DESC').limit(0, length).select(); // 这个取一半

        // 取最近点击部分数据
        let cnt = 0;
        let bookmarks2 = await this.model('bookmarks').where(condition).order('lastClick DESC').limit(0, pageSize * 2).select(); // 这个多取一点，有可能跟上面的重复了
        for (const bookmark of bookmarks2) {
          let find = bookmarks.find(item => item.id == bookmark.id);
          if (!find) {
            bookmarks.push(bookmark);
            cnt++;
            if (cnt >= length) break;
          }
        }

        // 取点击次数最多部分
        let bookmarks3 = await this.model('bookmarks').where(condition).order('clickCount DESC').limit(0, pageSize * 2).select(); // 这个多取一点，有可能跟上面的重复了
        for (const bookmark of bookmarks3) {
          let find = bookmarks.find(item => item.id == bookmark.id);
          if (!find) {
            bookmarks.push(bookmark);
            if (bookmarks.length >= pageSize) break;
          }
        }

        data = {
          count,
          totalPages,
          pageSize,
          data: bookmarks
        }
      } else {
        data = await this.model('bookmarks').where(condition).order(order).page(page, pageSize).countSelect();
      }
      this.json({ code: 0, data });
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  async bookmarksSearchAction() {
    let condition = {};
    let keyword = this.get("keyword");
    let tagIds = this.get("tagIds") || [];
    let range = this.get("range") || "self"; // self hot other
    let createdAt = this.get("createdAt");
    let lastClick = this.get("lastClick");
    let tableName = "bookmarks";

    if (range == "self") {
      condition.userId = this.ctx.state.user.id;
    } else if (range == "hot") {
      tableName = "hot_bookmarks";
    } else if (range == "other") {
      condition.userId = ['!=', this.ctx.state.user.id];
    }
    if (keyword) {
      condition._complex = {
        url: ['like', `%${keyword}%`],
        title: ['like', `%${keyword}%`],
        _logic: 'or'
      }
    }
    if (tagIds.length > 0) {
      condition.tagId = ['IN', tagIds];
    }
    if (createdAt) {
      condition.createdAt = ['between', createdAt];
    }
    if (lastClick) {
      condition.lastClick = ['between', lastClick];
    }

    try {
      let data = await this.model(tableName).where(condition).page(this.get('page') || 1, this.get('pageSize') || 20).countSelect();
      if (tableName == "bookmarks") {
        let ids = [];
        for (let bookmark of data.data) {
          ids.push(bookmark.tagId);
        }
        let tags = ids.length > 0 ? await this.model('tags').where({ id: ['IN', ids] }).select() : [];
        for (let bookmark of data.data) {
          bookmark.tagName = (tags.find((tag) => tag.id == bookmark.tagId) || { name: "未知分类" }).name;
        }
      }
      this.json({ code: 0, data });
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  // 点击书签
  async bookmarkClickAction() {
    let id = this.post("id");
    try {
      let data = await this.model('bookmarks').where({
        userId: this.ctx.state.user.id,
        id
      }).update({
        clickCount: ['exp', 'clickCount+1'],
        lastClick: ['exp', 'NOW()']
      });
      this.json({ code: 0, data });
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  // 快速跳转到网页
  async bookmarShortcutAction() {
    let url = this.post("url");
    try {
      let bookmark = await this.model('bookmarks').where({
        userId: this.ctx.state.user.id,
        url
      }).find();

      if (!think.isEmpty(bookmark)) {
        await this.model('bookmarks').where({
          userId: this.ctx.state.user.id,
          id: bookmark.id
        }).update({
          clickCount: ['exp', 'clickCount+1'],
          lastClick: ['exp', 'NOW()']
        });
        this.json({ code: 0, data: true });
      } else {
        this.json({ code: 0, data: false });
      }
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  // 更新书签
  async bookmarkUpdateAction() {
    let bookmark = this.post();
    try {
      let data = await this.model('bookmarks').where({
        userId: this.ctx.state.user.id,
        id: bookmark.id
      }).update(bookmark);
      this.json({ code: 0, data });
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  // 书签上传
  async bookmarkUploadAction() {
    // size: 367450,
    // path: 'C:\\Users\\lucq\\AppData\\Local\\Temp\\upload_4ae3b14dacaa107076d3bddd471ebe39.html',
    // name: 'exportbookmark-lcq-20200402084709.html',
    // type: 'text/html',
    const file = this.file("file");

    let bookmarks = [];

    let now = new Date().getTime();
    let fileName = 'uploadbookmark-' + this.ctx.state.user.username + '-' + now + '.html';
    if (file) {
      const filePath = path.join(think.ROOT_PATH, `runtime/upload/${fileName}`);
      await fs.ensureDir(path.dirname(filePath));
      await fs.move(file.path, filePath);
      let data = await fs.readFile(filePath);
      let $ = cheerio.load(data.toString());

      let anchors = $("dl").find("a");
      anchors.each(async (i, e) => {
        let url = $(e).attr("href");
        let title = $(e).text() || "无标题";
        if (title.length > 255) {
          title = title.substring(255);
        }
        title = title.replace(/\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDE4F]/gi, "");
        let attrCreatedAt = $(e).attr("add_date");
        let attrLastClick = $(e).attr("last_click");
        let attrClickCount = $(e).attr("click_count");
        let createdAt = think.datetime(attrCreatedAt ? parseInt(attrCreatedAt) * 1000 : new Date());
        let lastClick = think.datetime(attrLastClick ? parseInt(attrLastClick) * 1000 : new Date());
        let clickCount = attrClickCount ? parseInt(attrClickCount) : 1;

        // 只允许用一个标签
        let tagName = "未分类";
        $(e).parents("dl").each(function (ii, ee) {
          let folder = $(ee).prev();
          let temp = folder.text().replace(/(^\s*)|(\s*$)/g, '').replace(/\s+/g, ' ');
          if (temp != "Bookmarks" && temp != "书签栏" && temp != "" && temp != undefined) { tagName = temp; }
        });
        bookmarks.push({ title, url, createdAt, lastClick, tagName, clickCount, userId: this.ctx.state.user.id })
      });
    }

    let count = 0;
    let repeat = 0;
    let tags = await this.model('tags').where({ userId: this.ctx.state.user.id }).select();
    for (let bookmark of bookmarks) {
      let find = await this.model('bookmarks').where({ userId: this.ctx.state.user.id, url: bookmark.url }).find();
      if (think.isEmpty(find)) {
        let tag = tags.find(item => item.name == bookmark.tagName);
        if (tag) {
          bookmark.tagId = tag.id;
        } else {
          bookmark.tagId = await this.model("tags").add({ userId: this.ctx.state.user.id, name: bookmark.tagName });
          tags.push({
            id: bookmark.tagId,
            name: bookmark.tagName
          })
        }
        delete bookmark.tagName;
        await this.model("bookmarks").add(bookmark);
        count++;
      } else {
        repeat++;
      }
    }
    this.json({ code: 0, data: count, msg: `书签传入${bookmarks.length}个，重复书签${repeat}个，成功导入${count}个。` });
  }

  // 书签备份
  async bookmarkBackupAction() {
    let init = '<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1><DL id="0"></DL>';
    let $ = cheerio.load(init, {
      decodeEntities: false,
      xmlMode: true,
    });
    let time = (date) => parseInt(new Date(date).getTime() / 1000); // 日期转时间

    let tags = await this.model('tags').where({ userId: this.ctx.state.user.id }).order('sort ASC, lastUse DESC').select();
    for (const tag of tags) {
      $('#0').append(`<DT><H3>${tag.name}</H3></DT><DL id="${tag.id}"></DL>`);
      let bookmarks = await this.model('bookmarks').where({ tagId: tag.id }).select();
      for (const bookmark of bookmarks) {
        $('#' + tag.id).append(`<DT><A HREF="${bookmark.url}" ADD_DATE="${time(bookmark.createdAt)}" LAST_CLICK="${time(bookmark.lastClick)}" CLICK_COUNT="${bookmark.clickCount}" >${bookmark.title}</A></DT>`)
      }
    }
    let now = new Date().getTime()
    let fileName = 'exportbookmark-' + this.ctx.state.user.username + '-' + now + '.html';
    let filePath = path.join(think.ROOT_PATH, 'runtime', 'backup', fileName);

    await fs.ensureFile(filePath);
    await fs.writeFile(filePath, $.xml());
    this.json({ code: 0, data: fileName });

    setTimeout(async () => {
      let exists = await fs.pathExists(filePath);
      if (exists) {
        await fs.remove(filePath);
      }
    }, 1000 * 60 * 10); // 十分钟内没下载就给删掉
  }

  async bookmarkDownloadAction() {
    let fileName = this.get('fileName');
    let filePath = path.join(think.ROOT_PATH, 'runtime', 'backup', fileName);
    let exists = await fs.pathExists(filePath);
    if (exists) {
      await this.download(filePath);
      await fs.remove(filePath);
    } else {
      this.body = "文件不存在！";
    }
  }

  // 获取收趣的热门书签
  async hotBookmarksAction() {
    let page = this.get('page');
    let pageSize = parseInt(this.get('pageSize') || 50);
    try {
      // 如果是第0页而且是个人定制的，把 最近点击 与 最近新增 的返回去。
      let data = {};
      data = await this.model('hot_bookmarks').order('id DESC').page(page || 1, pageSize).countSelect();
      for (let bookmark of data.data) {
        if (!bookmark.tagName) {
          bookmark.tagName = "未知";
        }
      }
      this.json({ code: 0, data });
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  // 随机获取收趣的热门书签
  async hotBookmarksRandomAction() {
    try {
      let sql = `SELECT * FROM hot_bookmarks ORDER BY RAND() LIMIT 50;`;
      let data = await this.model('hot_bookmarks').query(sql);
      for (let bookmark of data) {
        if (!bookmark.tagName) {
          bookmark.tagName = "未知";
        }
      }
      this.json({ code: 0, data });
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  // 获取文章
  async articleAction() {
    let url = this.get("url");
    async function readArticle(url) {
      return new Promise(function (resolve, reject) {
        read(url, (err, article, meta) => {
          if (err) {
            reject(err)
          } else {
            resolve({
              title: article.title
            });
            article.close();
          }
        });
      })
    }

    try {
      let article = await readArticle(url);
      this.json({
        code: 0,
        data: {
          title: article.title
        }
      });
    } catch (error) {
      this.json({
        code: 1,
        msg: error.toString()
      });
    }
  }
  // 新增留言
  async adviceAddAction() {
    let advice = this.post();
    advice.userId = this.ctx.state.user.id;
    if (this.ctx.state.user.username == 'test') {
      return this.json({ code: 400, data: '', msg: `Test user forbid advice!` });
    }
    try {
      let res = await this.model("advices").add(advice);
      this.json({ code: 0, data: res, msg: `留言 添加成功` });
    } catch (error) {
      this.json({ code: 1, data: '', msg: error.toString() });
    }
  }

  // 获取所有留言
  async advicesAction() {
    try {
      let data = await this.model("advices").join('users ON users.id = advices.userId').order("createdAt DESC").field('advices.*,users.username').select();
      this.json({ code: 0, data });
    } catch (error) {
      this.json({ code: 1, data: '', msg: error.toString() });
    }
  }

  // 新增
  async noteAddAction() {
    let note = this.post();
    note.userId = this.ctx.state.user.id;
    try {
      // 没有分类的直接放未分类里面
      if (!note.tagId) {
        const name = "未分类";
        let tag = await this.model("tags").where({ name }).find();
        if (!think.isEmpty(tag)) {
          note.tagId = tag.id;
        } else {
          let tagId = await this.model("tags").add({
            userId: this.ctx.state.user.id,
            name
          });
          note.tagId = tagId;
        }
      }

      let data = await this.model("notes").add(note);
      this.json({ code: 0, data, msg: `备忘添加成功` });
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  // 更新备忘
  async noteUpdateAction() {
    let note = this.post();
    try {
      let data = await this.model('notes').where({
        userId: this.ctx.state.user.id,
        id: note.id
      }).update(note);
      this.json({ code: 0, data, msg: `备忘更新成功` });
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  // 更新
  async noteDelAction() {
    let note = this.post();
    note.userId = this.ctx.state.user.id;
    try {
      let data = await this.model("notes").where(note).delete();
      this.json({ code: 0, data, msg: `备忘删除成功` });
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  async notesAction() {
    let params = this.get();
    let where = {};
    try {
      if (params.keyword) {
        where.content = ['like', `%${params.keyword}%`]
      }
      if (params.tagId) {
        where.tagId = params.tagId;
      }
      where.userId = this.ctx.state.user.id;
      let data = await this.model('notes').where(where).order("createdAt DESC").page(this.get('page'), this.get('pageSize')).countSelect();
      this.json({ code: 0, data })
    } catch (error) {
      this.json({ code: 1, msg: error.toString() });
    }
  }

  async noteShareAction() {
    let id = this.get("id");
    let note = await this.model('notes').where({ id, public: 1 }).find();
    let body = think.isEmpty(note) ? "备忘为非公开或者已删除!" : note.content;
    this.body = `<body style="margin:0px;height:100%;">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, minimal-ui">
        <script>
          if(screen && screen.availWidth <= 1024) {
            setTimeout(() => {
              document.getElementById("note-div").style.width = "100%";
              document.getElementById("note-div").style["background-color"] = "#F3F4F5";
              document.getElementById("note").style.width = "95%";
            }, 100);
          }
        </script>
      </head>
      <div id="note-div" style="text-align:center;">
        <pre id="note" style="background-color:RGB(243,244,245); padding:0px 10px 0px 10px; margin:0px; width:60%; min-height:100%;display: inline-block;text-align: left; font-size: 15px; font-family:italic arial,sans-serif;word-wrap: break-word;white-space: pre-wrap;">\n\n${body}\n\n</pre>
      </div>
    </body>`;
  }
};
