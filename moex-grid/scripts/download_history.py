#!/usr/bin/env python3
"""Fetch verified MOEX perpetual-futures M1 candles into static JSON data files."""
import datetime as dt
import json
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/"data"
SYMBOLS=["IMOEXF","CNYRUBF","GAZPF","SLVRUBF","SBERF","GLDRUBF","USDRUBF","EURRUBF","RGBIF"]
UA="Mozilla/5.0 (compatible; MOEXGridLabHistory/1.0)"
TODAY=dt.datetime.now(dt.timezone.utc).date()
START=TODAY-dt.timedelta(days=14)
END=TODAY
def get(url):
    for attempt in range(3):
        try:
            req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"application/json"})
            with urllib.request.urlopen(req,timeout=30) as response:
                return json.load(response)
        except Exception as ex:
            if attempt==2:raise
            print("  retry",attempt+1,type(ex).__name__,str(ex)[:120],flush=True)
            time.sleep(1+attempt*2)
def row_from(b):
    try:
        row=[int(b.get("time",b.get("t"))),float(b.get("open",b.get("o"))),float(b.get("high",b.get("h"))),float(b.get("low",b.get("l"))),float(b.get("close",b.get("c")))]
        return row if row[0]>1_000_000_000 and row[2]>=row[3] and min(row[1:])>0 else None
    except (TypeError,ValueError):return None
def alor(symbol):
    end_ts=int(dt.datetime.combine(END+dt.timedelta(days=1),dt.time(),tzinfo=dt.timezone.utc).timestamp())
    t=int(dt.datetime.combine(START,dt.time(),tzinfo=dt.timezone.utc).timestamp())
    rows=[]
    while t<end_ts:
        to=min(t+2*86400,end_ts)
        params=urllib.parse.urlencode({"symbol":symbol,"exchange":"MOEX","instrumentGroup":"RFUD","tf":60,"from":t,"to":to-1,"format":"Simple"})
        j=get("https://api.alor.ru/md/v2/history?"+params)
        cand=j.get("history",j.get("bars",[])) if isinstance(j,dict) else []
        if not isinstance(cand,list):raise ValueError("ALOR unexpected format")
        rows.extend(r for b in cand if isinstance(b,dict) if (r:=row_from(b)) is not None)
        t=to
    if len(rows)<10:raise ValueError("ALOR returned only "+str(len(rows))+" candles")
    return rows
def moex(symbol):
    fromzone=dt.timezone(dt.timedelta(hours=3))
    rows=[];offset=0
    base=f"https://iss.moex.com/iss/engines/futures/markets/forts/boards/RFUD/securities/{symbol}/candles.json"
    while True:
        params=urllib.parse.urlencode({"from":START.isoformat(),"till":END.isoformat(),"interval":1,"start":offset,"iss.meta":"off","iss.only":"candles"})
        j=get(base+"?"+params);section=j.get("candles",{})
        columns=section.get("columns",[]);data=section.get("data",[])
        if not columns or not isinstance(data,list):raise ValueError("MOEX candles format changed")
        col={k:i for i,k in enumerate(columns)}
        for b in data:
            try:
                stamp=dt.datetime.strptime(b[col["begin"]],"%Y-%m-%d %H:%M:%S").replace(tzinfo=fromzone)
                r=[int(stamp.timestamp())]+[float(b[col[x]]) for x in ["open","high","low","close"]]
                if r[0]>1_000_000_000 and r[2]>=r[3] and min(r[1:])>0:rows.append(r)
            except (KeyError,TypeError,ValueError):continue
        offset+=len(data)
        if len(data)<100:break
        if offset>120000:raise ValueError("Exceeded candle safety limit")
    if len(rows)<10:raise ValueError("MOEX returned only "+str(len(rows))+" candles")
    return rows
def main():
    OUT.mkdir(exist_ok=True)
    success=0
    for symbol in SYMBOLS:
        rows=[];source=None
        for name,fn in [("ALOR",alor),("MOEX_ISS",moex)]:
            try:
                rows=fn(symbol);source=name
                print(symbol,name,len(rows),"raw candles",flush=True)
                break
            except Exception as ex:
                print(symbol,name,"FAILED",repr(ex)[:250],flush=True)
        if not rows:
            print(symbol,"NO DATA, preserving older file if any",flush=True)
            continue
        unique={row[0]:row for row in rows}
        rows=[unique[t] for t in sorted(unique)]
        if len(rows)<10:
            print(symbol,"NOT ENOUGH VALID DATA",flush=True);continue
        payload={"symbol":symbol,"source":source,"period":{"from":START.isoformat(),"to":END.isoformat()},"retrieved_utc":dt.datetime.now(dt.timezone.utc).isoformat(),"interval_seconds":60,"columns":["time","open","high","low","close"],"rows":rows}
        path=OUT/(symbol+".json")
        path.write_text(json.dumps(payload,separators=(",",":"),ensure_ascii=False),encoding="utf-8")
        print(symbol,"SAVED",len(rows),"rows",path.stat().st_size,"bytes",flush=True)
        success+=1
    print("SUCCESS",success,"/",len(SYMBOLS),flush=True)
    if success==0:raise SystemExit("No real historical data could be fetched from either provider.")
if __name__=="__main__":main()
