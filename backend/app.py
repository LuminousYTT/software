from flask import Flask, request, jsonify
from flask_cors import CORS
import uuid
import os
import pymysql
from pymysql.cursors import DictCursor
from contextlib import contextmanager
from datetime import datetime

app = Flask(__name__)
# 允许从本地文件打开的页面（origin 为 null）和任意来源访问 /api/*
CORS(app, resources={r"/api/*": {"origins": "*"}})

############################################
# 配置 & 数据库连接
############################################

DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "9860")
DB_NAME = os.getenv("DB_NAME", "green")
DB_CREATE_DB = os.getenv("DB_CREATE_DB", "0") == "1"

# token -> uid 映射（内存会话管理）
tokens = {}

# 出行方式与积分倍率（与前端保持一致，且与 points.movement 的枚举匹配）
RATE_BY_MODE = {"bike": 3, "walk": 3, "bus": 1.5, "metro": 1.5, "ev": 1}
MODE_EN_TO_CN = {"bike": "骑行", "walk": "步行", "bus": "公交出行", "metro": "地铁出行", "ev": "公交出行"}


def _connect(database: str | None = None):
    # 当 database 为空时，不指定默认库，用于创建数据库
    kwargs = dict(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=False,
    )
    if database is not None:
        kwargs["database"] = database
    else:
        kwargs["database"] = DB_NAME if DB_CREATE_DB is False else None
    return pymysql.connect(**kwargs)


@contextmanager
def db_conn(database: str | None = None):
    # 默认连接到目标库；当需要裸连接时传入 None
    conn = _connect(database if database is not None else DB_NAME)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def ensure_database_and_tables():
    # 可选创建数据库
    if DB_CREATE_DB:
        with _connect(database=None) as conn:
            with conn.cursor() as cur:
                cur.execute(f"CREATE DATABASE IF NOT EXISTS `{DB_NAME}` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;")
            conn.commit()

    # 创建数据表（幂等）
    ddl_user = (
        """
        CREATE TABLE IF NOT EXISTS `user` (
            uid CHAR(10) PRIMARY KEY,
            `password` CHAR(20),
            phone_num CHAR(20),
            sum_ji INT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        """
    )

    ddl_shop = (
        """
        CREATE TABLE IF NOT EXISTS `shop` (
            sid CHAR(10) PRIMARY KEY,
            sname CHAR(50),
            `password` CHAR(20),
            phone_num CHAR(20)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        """
    )

    ddl_points = (
        """
        CREATE TABLE IF NOT EXISTS `points` (
            uid CHAR(10) PRIMARY KEY,
            date_time DATETIME,
            movement ENUM('骑行','地铁出行','公交出行','步行','兑换'),
            `distance` DOUBLE,
            ji INT,
            FOREIGN KEY (uid) REFERENCES `user`(uid)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        """
    )

    ddl_goods = (
        """
        CREATE TABLE IF NOT EXISTS `goods` (
            gid INT PRIMARY KEY,
            gname CHAR(50),
            sid CHAR(10),
            count INT,
            `value` INT,
            FOREIGN KEY (sid) REFERENCES `shop`(sid)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        """
    )

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(ddl_user)
            cur.execute(ddl_shop)
            cur.execute(ddl_points)
            cur.execute(ddl_goods)


def get_token_from_auth_header():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth.split(" ", 1)[1].strip()
    return None


@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    phone = (data.get("phone") or "").strip()

    if not username or not password:
        return jsonify({"error": "用户名和密码为必填"}), 400
    if len(username) > 10:
        return jsonify({"error": "用户名长度不能超过10"}), 400
    if len(password) > 20:
        return jsonify({"error": "密码长度不能超过20"}), 400
    if phone and len(phone) > 20:
        return jsonify({"error": "手机号长度不能超过20"}), 400
    # uid 使用 username，初始积分为 0
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                # 检查是否已存在
                cur.execute("SELECT uid FROM `user` WHERE uid=%s", (username,))
                if cur.fetchone():
                    return jsonify({"error": "用户名已存在"}), 400
                cur.execute(
                    "INSERT INTO `user` (uid, `password`, phone_num, sum_ji) VALUES (%s,%s,%s,%s)",
                    (username, password, phone, 0),
                )
        token = uuid.uuid4().hex
        tokens[token] = username
        return jsonify({
            "token": token,
            "user": {"username": username, "points": 0}
        })
    except Exception as e:
        return jsonify({"error": f"注册失败: {e}"}), 500


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT uid, `password`, sum_ji FROM `user` WHERE uid=%s", (username,))
                row = cur.fetchone()
                if not row or (row.get("password") or "").strip() != password:
                    return jsonify({"error": "用户名或密码错误"}), 401
                points = int(row.get("sum_ji") or 0)
        token = uuid.uuid4().hex
        tokens[token] = username
        return jsonify({
            "token": token,
            "user": {"username": username, "points": points}
        })
    except Exception as e:
        return jsonify({"error": f"登录失败: {e}"}), 500


@app.get("/api/me")
def me():
    token = get_token_from_auth_header()
    if not token or token not in tokens:
        return jsonify({"error": "未授权"}), 401
    username = tokens[token]
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT sum_ji FROM `user` WHERE uid=%s", (username,))
                row = cur.fetchone()
                if not row:
                    return jsonify({"error": "用户不存在"}), 404
                points = int(row.get("sum_ji") or 0)
        return jsonify({"user": {"username": username, "points": points}})
    except Exception as e:
        return jsonify({"error": f"查询失败: {e}"}), 500


@app.post("/api/trips")
def submit_trip():
    token = get_token_from_auth_header()
    if not token or token not in tokens:
        return jsonify({"error": "未授权"}), 401
    username = tokens[token]
    data = request.get_json(silent=True) or {}
    mode = (data.get("mode") or "").strip()
    distance = float(data.get("distance") or 0)
    if mode not in RATE_BY_MODE or distance <= 0:
        return jsonify({"error": "参数不合法"}), 400

    earned = int(round(distance * RATE_BY_MODE[mode]))
    movement_cn = MODE_EN_TO_CN[mode]
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                # 记录积分变动
                cur.execute(
                    """
                    INSERT INTO `points`(uid, date_time, movement, `distance`, ji)
                    VALUES (%s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        date_time=VALUES(date_time),
                        movement=VALUES(movement),
                        `distance`=VALUES(`distance`),
                        ji=VALUES(ji)
                    """,
                    (username, datetime.now(), movement_cn, distance, earned),
                )
                # 更新总积分
                cur.execute(
                    "UPDATE `user` SET sum_ji = COALESCE(sum_ji,0) + %s WHERE uid=%s",
                    (earned, username),
                )
                # 查询最新积分返回
                cur.execute("SELECT sum_ji FROM `user` WHERE uid=%s", (username,))
                points = int((cur.fetchone() or {}).get("sum_ji") or 0)
        return jsonify({"earned": earned, "user": {"username": username, "points": points}})
    except Exception as e:
        return jsonify({"error": f"上报失败: {e}"}), 500


@app.post("/api/redeem")
def redeem():
    token = get_token_from_auth_header()
    if not token or token not in tokens:
        return jsonify({"error": "未授权"}), 401
    username = tokens[token]
    data = request.get_json(silent=True) or {}
    product_name = (data.get("productName") or "").strip()
    required_points = int(data.get("requiredPoints") or 0)
    if required_points <= 0:
        return jsonify({"error": "参数不合法"}), 400

    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                # 当前积分
                cur.execute("SELECT sum_ji FROM `user` WHERE uid=%s", (username,))
                row = cur.fetchone()
                if not row:
                    return jsonify({"error": "用户不存在"}), 404
                current = int(row.get("sum_ji") or 0)
                # 尝试从 goods 查找该商品
                cost = required_points
                goods_found = None
                if product_name:
                    cur.execute("SELECT gid, gname, `value`, `count` FROM `goods` WHERE gname=%s", (product_name,))
                    goods_found = cur.fetchone()
                    if goods_found:
                        if int(goods_found.get("count") or 0) <= 0:
                            return jsonify({"error": "该商品库存不足"}), 400
                        cost = int(goods_found.get("value") or required_points)

                if current < cost:
                    return jsonify({"error": f"积分不足，还需 {cost - current} 积分"}), 400

                # 记录兑换为负积分
                cur.execute(
                    """
                    INSERT INTO `points`(uid, date_time, movement, `distance`, ji)
                    VALUES (%s, %s, '兑换', %s, %s)
                    ON DUPLICATE KEY UPDATE
                        date_time=VALUES(date_time),
                        movement=VALUES(movement),
                        `distance`=VALUES(`distance`),
                        ji=VALUES(ji)
                    """,
                    (username, datetime.now(), 0.0, -cost),
                )
                # 扣减积分
                cur.execute(
                    "UPDATE `user` SET sum_ji = COALESCE(sum_ji,0) - %s WHERE uid=%s",
                    (cost, username),
                )
                # 扣减库存（若商品存在）
                if goods_found:
                    cur.execute("UPDATE `goods` SET `count` = `count` - 1 WHERE gid=%s", (goods_found["gid"],))

                # 查询最新积分
                cur.execute("SELECT sum_ji FROM `user` WHERE uid=%s", (username,))
                new_points = int((cur.fetchone() or {}).get("sum_ji") or 0)
        return jsonify({
            "success": True,
            "product": product_name,
            "user": {"username": username, "points": new_points}
        })
    except Exception as e:
        return jsonify({"error": f"兑换失败: {e}"}), 500


@app.post("/api/logout")
def logout():
    token = get_token_from_auth_header()
    if token and token in tokens:
        tokens.pop(token, None)
    return jsonify({"success": True})


if __name__ == "__main__":
    # 启动时确保表已创建（根据环境变量可选创建数据库）
    try:
        ensure_database_and_tables()
    except Exception as e:
        print(f"[WARN] 初始化数据库/数据表时发生错误: {e}")
    app.run(host="127.0.0.1", port=5000, debug=True)
