"use client"
import { FaEllipsisH } from 'react-icons/fa';
import { BarChart, Bar, Rectangle, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

{ /* BAR CHART CODE */ }
const data = [
  {
    name: 'Mon',
    present: 70,
    absent: 60,
  },
  {
    name: 'Tue',
    present: 60,
    absent: 40,
  },
  {
    name: 'Wed',
    present: 90,
    absent: 50,
  },
  {
    name: 'Thu',
    present: 80,
    absent: 60,
  },
  {
    name: 'Fri',
    present: 70,
    absent: 50,
  },
];

const AttendanceChart = () => {
  return (
    /* ATTENDANCE CHART CONTAINER */
    <div className='bg-white rounded-xl dark:rounded-3xl p-4 h-full bg-dark-2 '>
       
      { /* TITLE CONTAINER */ }
      <div className='flex justify-between items-center'>

        { /* TITLE */ }
        <h1 className=' text-lg font-semibold' >Attendance </h1>

        { /* ICON IMAGE */ }
        < FaEllipsisH width={20} height={20} className='cursor-pointer text-gray-400'/>

      </div>

      { /* BAR CHART CONTAINER */ }  
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          width={500}
          height={300}
          data={data}
          barSize={20}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke='#ddd' />
          <XAxis dataKey="name"axisLine={false} tick={{fill:"#6b7280"}} tickLine={false}  />
          <YAxis axisLine={false} tick={{fill:"#6b7280"}} tickLine={false} />
          <Tooltip contentStyle={{ borderRadius: '10px', borderColor: 'lightgray', backgroundColor:'grey'}} />
          <Legend align='left' verticalAlign='top' wrapperStyle={{paddingTop: '20px', paddingBottom: '40px'}} />
          
          <Bar 
            dataKey="absent" 
            fill="#FAE27C" 
            legendType='circle' 
            radius={[10, 10, 0, 0]}
          />
          
          <Bar 
            dataKey="present" 
            fill="#C3EBFA" 
            legendType='circle'
            radius={[10, 10, 0, 0]}
          />

        </BarChart>
      </ResponsiveContainer>

    </div>
  )
}

export default AttendanceChart