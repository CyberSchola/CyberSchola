"use client"
import Image from 'next/image';
import { FaEllipsisH } from 'react-icons/fa';
import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts';

 { /* RADIO CHART CODE */ }
const data = [
  {
    name: 'Boys',
    count: 53,
    fill: '#C3EBFA',
  },
  {
    name: 'Girls',
    count: 53,
    fill: '#FAE27C',
  },
  {
    name: 'Total',
    count: 106,
    fill: 'white',
  },
];

const CountChart = () => {
  return ( 

     /* STUDENT CHART MAIN CONTAINER */ 
    <div className=' bg-white rounded-2xl dark:rounded-3xl w-full h-full p-4 bg-dark '>
      
      { /* TITLE AND MORE IMAGE ICON CONTAINER */ }
      <div className='flex justify-between items-center'>
        <h1 className=' text-lg font-semibold'>Students</h1>
        < FaEllipsisH width={20} height={20} className='cursor-pointer text-gray-400'/>
      </div>
       
      { /* CHART CONTAINER*/ }
      <div className=' relative w-full h-[75%]'>
        
        { /* CHART */ }
        <ResponsiveContainer>
          <RadialBarChart cx="50%" cy="50%" innerRadius="40%" outerRadius="100%" barSize={32} data={data}style={{ outline: 'none' }}>
            <RadialBar
              background
              dataKey="count"
            />
          </RadialBarChart>
        </ResponsiveContainer>

        { /* CHART IMAGE */ }
        <Image src="/maleFemale.png" alt="" width={50} height={50} className=' absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' />
      </div>

      { /* BOTTOM CONTENT */ }
      <div className=' flex justify-center gap-16'>

        { /* BOYS TOTAL COUNT */ }
        <div className=' flex flex-col gap-1'>
          <div className=' w-5 h-5 bg-PatoSky1 rounded-full '/>
            <h1 className='font-bold'>4,321</h1>
            <h2 className=' text-xs text-gray-300'>Boys (55%)</h2>
       </div>
          
          { /* GIRLS TOTAL COUNT */ }
         <div className=' flex flex-col gap-1'>
          <div className=' w-5 h-5 bg-PatoYellow rounded-full '/>
            <h1 className='font-bold'>4,321</h1>
            <h2 className=' text-xs text-gray-300'>Girls (45%)</h2>
        </div>

      </div>

    </div>
  );
};

export default CountChart;