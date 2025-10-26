import React from 'react';
export function Card({className="",...p}){return <div className={["rounded-2xl border bg-white shadow-sm",className].join(" ")} {...p}/>}
export function CardHeader({className="",...p}){return <div className={["p-4",className].join(" ")} {...p}/>}
export function CardTitle({className="",...p}){return <h3 className={["text-lg font-semibold",className].join(" ")} {...p}/>}
export function CardContent({className="",...p}){return <div className={["p-4",className].join(" ")} {...p}/>}