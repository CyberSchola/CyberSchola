"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form";
import { z } from "zod"
import InputField from "../InputField";

/* Schema for Form validation */
const schema = z.object({

  user: z.string().min(1, { error: 'Event Title is required!' }),

  class: z.string().min(1, { message: 'Class Name is required!' }),

  date: z.string().min(1, { message: 'Date is required!' }),

  startTime: z.string().min(1, { message: 'Start Time is required!' }),

  endTime: z.string().min(1, { message: 'End Time is required!' }),

  

});

{ /* ZOD */ }
type Inputs = z.infer<typeof schema>


const EventForm = ( { type, data }: { type: "create" | "update"; data?: any; }) => {
  
  { /* ZOD */ }
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Inputs> ({
    resolver: zodResolver(schema),
  });


  const onSubmit = handleSubmit( (data) => {
    console.log(data);
  } )

 
 return (
    
     /* FORM */ 
    <form className=" flex flex-col gap-8 " onSubmit={onSubmit} >

      { /* CONDITION FOR FORM HEADING */ }
      { type === "create" ? < h1 className="text-xl font-semibold">Create A New Event</h1> : < h1 className="text-xl font-semibold">Update Event</h1> }

      { /* FORM MODAL LABEL 1 */ }
      <span className="text-xs text-gray-400 font-medium">
        Events Information
      </span>

      { /* AUTHENTICATION INPUTS MAIN CONTAINER 1 */ }
      <div className="flex justify-between flex-wrap gap-4 ">

        { /* AUTHENTICATION INFROMATION INPUTS */ }

        <InputField label="Event Title" name="user" defaultValue= {data?.title} register={register} error={errors.user}  />   
         
        <InputField label="Class Name" name="class" defaultValue= {data?.class} register={register} error={errors.class} />

        <InputField label="Due-Date" name="date" defaultValue= {data?.date} register={register} error={errors.date} />   

        <InputField label="Start Time" name="startTime" defaultValue= {data?.startTime} register={register} error={errors.startTime} />

        <InputField label="End Time" name="endTime" defaultValue= {data?.endTime} register={register} error={errors.endTime} />

      </div>
      

      { /* UPDATE AND CREATE BUTTON */ }
      <button className="bg-blue-400 text-white p-2 rounded-md">
        { type === "create" ? "Create" : "Update" }
      </button>

    </form>

  )
}

export default EventForm